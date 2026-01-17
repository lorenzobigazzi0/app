from __future__ import annotations

import random
import string
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import Base, engine, get_db, SessionLocal
from .models import CallEvent, CallType, MenuItem, Order, OrderItem, OrderStatus, Printer, PrintJob, Role, Table, User
from .printers import get_adapter
from .realtime import manager
from .schemas import CallIn, CallOut, CreateOrderIn, MenuItemOut, OrderOut, Token, UpdateItemDoneIn, UserOut
from .security import create_access_token, hash_password, verify_password, get_current_user

app = FastAPI(title="Cassa Realtime Backend", version="0.1.0")

app.add_middleware(
	CORSMiddleware,
	allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()] if settings.CORS_ORIGINS else ["*"],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

# Serve frontend static (dev-friendly)
app.mount("/bar", StaticFiles(directory="../frontend/bar", html=True), name="bar")
app.mount("/cameriere", StaticFiles(directory="../frontend/cameriere", html=True), name="cameriere")
app.mount("/cassa", StaticFiles(directory="../frontend/cassa", html=True), name="cassa")
app.mount("/admin", StaticFiles(directory="../frontend/admin", html=True), name="admin")


def _rand_public_id(n: int = 5) -> str:
	return "".join(random.choice(string.digits) for _ in range(n))


def _order_to_out(order: Order, table_number: int, waiter_name: str) -> OrderOut:
	return OrderOut(
		id=order.id,
		public_id=order.public_id,
		table_id=order.table_id,
		table_number=table_number,
		waiter_id=order.waiter_id,
		waiter_name=waiter_name,
		covers=order.covers,
		apericena=order.apericena,
		note=order.note,
		status=order.status,
		created_at=order.created_at,
		ready_at=order.ready_at,
		items=[
			{
				"id": it.id,
				"line_no": it.line_no,
				"menu_item_id": it.menu_item_id,
				"name": it.name,
				"note": it.note,
				"qty": it.qty,
				"is_done": it.is_done,
			}
			for it in order.items
		],
	)


async def _ensure_seed(db: AsyncSession) -> None:
	# Users
	res = await db.execute(select(User).limit(1))
	if res.scalar_one_or_none() is None:
		users = [
			User(username="admin", display_name="Admin", role=Role.ADMIN, password_hash=hash_password("admin")),
			User(username="emma", display_name="Emma", role=Role.WAITER, password_hash=hash_password("1234")),
			User(username="luca", display_name="Luca", role=Role.WAITER, password_hash=hash_password("1234")),
			User(username="marco", display_name="Marco", role=Role.CASHIER, password_hash=hash_password("1234")),
			User(username="bar", display_name="Bar", role=Role.BAR, password_hash=hash_password("1234")),
		]
		db.add_all(users)

	# Tables 1..30
	res = await db.execute(select(Table).limit(1))
	if res.scalar_one_or_none() is None:
		db.add_all([Table(number=i) for i in range(1, 31)])

	# Menu demo
	res = await db.execute(select(MenuItem).limit(1))
	if res.scalar_one_or_none() is None:
		db.add_all([
			MenuItem(sku="spritz", name="Spritz", category="Drink", price=6.00),
			MenuItem(sku="gin_tonic", name="Gin Tonic", category="Drink", price=8.00),
			MenuItem(sku="negroni", name="Negroni", category="Drink", price=9.00),
			MenuItem(sku="analcolico", name="Analcolico", category="Drink", price=5.00),
			MenuItem(sku="caffe", name="Caffè", category="Caffetteria", price=1.20),
			MenuItem(sku="cappuccino", name="Cappuccino", category="Caffetteria", price=1.80),
			MenuItem(sku="cornetto", name="Cornetto", category="Caffetteria", price=1.50),
			MenuItem(sku="tagliere", name="Tagliere", category="Apericena", price=12.00),
			MenuItem(sku="nachos", name="Nachos", category="Apericena", price=7.50),
			MenuItem(sku="patatine", name="Patatine", category="Apericena", price=4.00),
		])

	# Printer demo
	res = await db.execute(select(Printer).limit(1))
	if res.scalar_one_or_none() is None:
		db.add(Printer(name="BAR_PRINTER", kind="dummy", connection="bar"))

	await db.commit()


@app.on_event("startup")
async def on_startup() -> None:
	async with engine.begin() as conn:
		await conn.run_sync(Base.metadata.create_all)
	# seed
	async with SessionLocal() as db:
		await _ensure_seed(db)


# ----------------------------- AUTH -----------------------------
@app.post("/api/auth/login", response_model=Token)
async def login(data: Dict[str, str], db: AsyncSession = Depends(get_db)):
	username = (data.get("username") or "").strip().lower()
	password = data.get("password") or ""
	res = await db.execute(select(User).where(User.username == username, User.is_active == True))
	user = res.scalar_one_or_none()
	if not user or not verify_password(password, user.password_hash):
		raise HTTPException(status_code=401, detail="Credenziali non valide")
	return Token(access_token=create_access_token(user.username))


@app.get("/api/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
	return UserOut(id=user.id, username=user.username, display_name=user.display_name, role=user.role)


# ----------------------------- MENU -----------------------------
@app.get("/api/menu", response_model=List[MenuItemOut])
async def list_menu(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
	res = await db.execute(select(MenuItem).where(MenuItem.is_active == True).order_by(MenuItem.category, MenuItem.name))
	items = res.scalars().all()
	return [MenuItemOut(id=i.id, sku=i.sku, name=i.name, category=i.category, price=float(i.price)) for i in items]


# ----------------------------- ORDERS -----------------------------
@app.get("/api/orders", response_model=List[OrderOut])
async def list_orders(
	status: Optional[OrderStatus] = Query(default=None),
	db: AsyncSession = Depends(get_db),
	user: User = Depends(get_current_user),
):
	q = select(Order, Table.number, User.display_name).join(Table, Table.id == Order.table_id).join(User, User.id == Order.waiter_id)
	if status:
		q = q.where(Order.status == status)
	res = await db.execute(q.order_by(Order.created_at.desc()))
	rows = res.all()
	out: List[OrderOut] = []
	for order, tnum, waiter_name in rows:
		await db.refresh(order, attribute_names=["items"])  # ensure items
		out.append(_order_to_out(order, tnum, waiter_name))
	return out


@app.post("/api/orders", response_model=OrderOut)
async def create_order(
	data: CreateOrderIn,
	db: AsyncSession = Depends(get_db),
	user: User = Depends(get_current_user),
):
	if user.role not in (Role.WAITER, Role.CASHIER, Role.ADMIN):
		raise HTTPException(status_code=403, detail="Ruolo non autorizzato")

	res = await db.execute(select(Table).where(Table.number == data.table_number))
	table = res.scalar_one_or_none()
	if not table:
		raise HTTPException(status_code=404, detail="Tavolo non trovato")

	public_id = _rand_public_id()
	# avoid collision (rare)
	for _ in range(3):
		res = await db.execute(select(Order).where(Order.public_id == public_id))
		if res.scalar_one_or_none() is None:
			break
		public_id = _rand_public_id()

	order = Order(
		public_id=public_id,
		table_id=table.id,
		waiter_id=user.id,
		covers=data.covers,
		apericena=data.apericena,
		note=data.note,
		status=OrderStatus.OPEN,
	)
	db.add(order)
	await db.flush()  # get order.id

	# Unifica le righe duplicate (stesso prodotto + stessa nota) sommando le quantita'.
	# Questo evita che il BAR veda righe ripetute e garantisce che la quantita' sia sempre corretta.
	agg: dict[tuple[int, str | None], int] = {}
	for it in data.items:
		key = (int(it.menu_item_id), (it.note or None))
		agg[key] = agg.get(key, 0) + int(it.qty)

	# Carica i menu item una volta sola
	menu_ids = sorted({mid for (mid, _note) in agg.keys()})
	res = await db.execute(select(MenuItem).where(MenuItem.id.in_(menu_ids), MenuItem.is_active == True))
	menu_items = {m.id: m for m in res.scalars().all()}
	missing = [mid for mid in menu_ids if mid not in menu_items]
	if missing:
		raise HTTPException(status_code=400, detail=f"Articolo non valido: {missing[0]}")

	line_no = 1
	for (menu_item_id, note), qty in agg.items():
		mi = menu_items[menu_item_id]
		item = OrderItem(
			order_id=order.id,
			line_no=line_no,
			menu_item_id=mi.id,
			name=mi.name,
			note=note,
			qty=qty,
			is_done=False,
		)
		db.add(item)
		line_no += 1

	table.is_open = True
	table.opened_by_user_id = user.id
	if not table.opened_at:
		table.opened_at = datetime.utcnow()

	await db.commit()
	await db.refresh(order)
	await db.refresh(order, attribute_names=["items"]) 
	out = _order_to_out(order, table.number, user.display_name)

	await manager.broadcast_many(["bar", "admin", "cassa"], {"type": "order_created", "order": out.model_dump(mode="json")})
	await manager.broadcast("waiter", {"type": "order_created", "order": out.model_dump(mode="json")})
	return out


@app.patch("/api/orders/{public_id}/items/{item_id}", response_model=OrderOut)
async def set_item_done(
	public_id: str,
	item_id: int,
	data: UpdateItemDoneIn,
	db: AsyncSession = Depends(get_db),
	user: User = Depends(get_current_user),
):
	if user.role not in (Role.BAR, Role.ADMIN):
		raise HTTPException(status_code=403, detail="Solo BAR/ADMIN")

	res = await db.execute(select(Order).where(Order.public_id == public_id))
	order = res.scalar_one_or_none()
	if not order:
		raise HTTPException(status_code=404, detail="Comanda non trovata")

	res = await db.execute(select(OrderItem).where(OrderItem.id == item_id, OrderItem.order_id == order.id))
	item = res.scalar_one_or_none()
	if not item:
		raise HTTPException(status_code=404, detail="Riga non trovata")

	item.is_done = data.is_done

	# if all done => READY
	res = await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))
	items = res.scalars().all()
	if items and all(i.is_done for i in items):
		order.status = OrderStatus.READY
		order.ready_at = datetime.utcnow()

	await db.commit()
	# reload with joins
	row = await db.execute(
		select(Order, Table.number, User.display_name)
		.join(Table, Table.id == Order.table_id)
		.join(User, User.id == Order.waiter_id)
		.where(Order.id == order.id)
	)
	order2, tnum, waiter_name = row.one()
	await db.refresh(order2, attribute_names=["items"])
	out = _order_to_out(order2, tnum, waiter_name)
	await manager.broadcast_many(["bar", "admin", "cassa", "waiter"], {"type": "order_updated", "order": out.model_dump(mode="json")})
	return out


@app.post("/api/orders/{public_id}/print")
async def print_order(
	public_id: str,
	printer_name: str = Query(default="BAR_PRINTER"),
	db: AsyncSession = Depends(get_db),
	user: User = Depends(get_current_user),
):
	if user.role not in (Role.BAR, Role.CASHIER, Role.ADMIN):
		raise HTTPException(status_code=403, detail="Ruolo non autorizzato")

	row = await db.execute(
		select(Order, Table.number, User.display_name)
		.join(Table, Table.id == Order.table_id)
		.join(User, User.id == Order.waiter_id)
		.where(Order.public_id == public_id)
	)
	one = row.first()
	if not one:
		raise HTTPException(status_code=404, detail="Comanda non trovata")
	order, tnum, waiter_name = one
	await db.refresh(order, attribute_names=["items"])

	pr = await db.execute(select(Printer).where(Printer.name == printer_name, Printer.is_active == True))
	printer = pr.scalar_one_or_none()
	if not printer:
		raise HTTPException(status_code=404, detail="Stampante non trovata")

	text = _format_print(order, tnum, waiter_name)
	job = PrintJob(order_id=order.id, printer_id=printer.id, payload_text=text, status="QUEUED")
	db.add(job)
	await db.commit()

	adapter = get_adapter(printer.kind)
	result = adapter.send(printer.connection, title=f"Comanda #{order.public_id}", text=text)

	if result.ok:
		job.status = "SENT"
		job.sent_at = datetime.utcnow()
		order.status = OrderStatus.PRINTED if order.status != OrderStatus.CLOSED else order.status
	else:
		job.status = "ERROR"
		job.error = result.error
	await db.commit()

	await manager.broadcast_many(["bar", "admin", "cassa", "waiter"], {"type": "print_job", "public_id": public_id, "ok": result.ok, "error": result.error})
	return {"ok": result.ok, "error": result.error}


def _format_print(order: Order, table_number: int, waiter_name: str) -> str:
	lines: List[str] = []
	lines.append("==============================")
	lines.append(f"COMANDA #{order.public_id}  TAVOLO {table_number}")
	lines.append(f"CAMERIERE: {waiter_name}")
	lines.append(f"COPERTI: {order.covers}  APERICENA: {order.apericena}")
	if order.note:
		lines.append(f"NOTE: {order.note}")
	lines.append("------------------------------")
	for it in order.items:
		q = f"x{it.qty}" if it.qty != 1 else ""
		note = f" ({it.note})" if it.note else ""
		chk = "[x]" if it.is_done else "[ ]"
		lines.append(f"{chk} {q} {it.name}{note}")
	lines.append("==============================")
	lines.append(datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"))
	return "\n".join(lines) + "\n"


# ----------------------------- CALLS -----------------------------
@app.post("/api/calls", response_model=CallOut)
async def create_call(
	data: CallIn,
	db: AsyncSession = Depends(get_db),
	user: User = Depends(get_current_user),
):
	to_user_id = data.to_user_id
	table_id = None
	order_id = None
	if data.table_number is not None:
		res = await db.execute(select(Table).where(Table.number == data.table_number))
		t = res.scalar_one_or_none()
		table_id = t.id if t else None
	if data.order_public_id:
		res = await db.execute(select(Order).where(Order.public_id == data.order_public_id))
		o = res.scalar_one_or_none()
		order_id = o.id if o else None

	event = CallEvent(
		call_type=data.call_type,
		from_user_id=user.id,
		to_user_id=to_user_id,
		table_id=table_id,
		order_id=order_id,
		message=data.message,
		is_ack=False,
	)
	db.add(event)
	await db.commit()
	await db.refresh(event)

	payload = CallOut(
		id=event.id,
		call_type=event.call_type,
		from_user_id=event.from_user_id,
		to_user_id=event.to_user_id,
		table_id=event.table_id,
		order_id=event.order_id,
		message=event.message,
		is_ack=event.is_ack,
		created_at=event.created_at,
		acked_at=event.acked_at,
	)

	# route channels based on call type
	# NOTE: inviamo sempre ad ADMIN e, per CALL_WAITER, anche a CASSA (utile per monitoraggio).
	channels = ["admin"]
	if data.call_type == CallType.CALL_WAITER:
		channels.extend(["waiter", "cassa"])
	else:
		channels.append("bar")
	# Compat: alcuni client piu' vecchi ascoltano "call.created".
	await manager.broadcast_many(
		channels,
		{
			"type": "call_created",
			"event": "call.created",
			"call": payload.model_dump(mode="json"),
		},
	)
	return payload


@app.post("/api/calls/{call_id}/ack")
async def ack_call(
	call_id: int,
	db: AsyncSession = Depends(get_db),
	user: User = Depends(get_current_user),
):
	res = await db.execute(select(CallEvent).where(CallEvent.id == call_id))
	ce = res.scalar_one_or_none()
	if not ce:
		raise HTTPException(status_code=404, detail="Chiamata non trovata")
	ce.is_ack = True
	ce.acked_at = datetime.utcnow()
	await db.commit()
	await manager.broadcast_many(["admin", "bar", "waiter", "cassa"], {"type": "call_acked", "call_id": call_id})
	return {"ok": True}


# ----------------------------- WEBSOCKET -----------------------------
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str = Query(default=""), channel: str = Query(default=""), db: AsyncSession = Depends(get_db)):
	# very small auth: decode token and map to a channel, fallback to requested channel only for dev
	user: Optional[User] = None
	try:
		# reuse oauth2 logic: expect Authorization header is not possible in browser WS easily
		from jose import jwt
		payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
		username = payload.get("sub")
		if username:
			res = await db.execute(select(User).where(User.username == username))
			user = res.scalar_one_or_none()
	except Exception:
		user = None

	# derive channel
	ch = "admin" if channel == "admin" else "public"
	if user:
		if user.role == Role.BAR:
			ch = "bar"
		elif user.role == Role.WAITER:
			ch = "waiter"
		elif user.role == Role.CASHIER:
			ch = "cassa"
		elif user.role == Role.ADMIN:
			ch = "admin"
	else:
		# dev: accept explicit channel
		if channel in ("bar", "waiter", "cassa", "admin"):
			ch = channel

	await manager.connect(ws, ch)
	try:
		# send hello
		await ws.send_json({"type": "hello", "channel": ch, "user": user.username if user else None})
		while True:
			# We don't require client messages now; keep it open.
			await ws.receive_text()
	except WebSocketDisconnect:
		manager.disconnect(ws)
	except Exception:
		manager.disconnect(ws)
