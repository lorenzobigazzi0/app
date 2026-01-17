from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .models import User, Table, Ticket, TicketItem, Call, Printer, PrintJob
from .schemas import (
    LoginIn, TokenOut, UserOut,
    TicketCreateIn, TicketOut, TicketItemOut,
    CallCreateIn, CallOut,
)
from .auth import verify_password, create_access_token, get_token
from .realtime import hub
from .printing import adapter

router = APIRouter(prefix="/api")


def ticket_to_out(t: Ticket) -> TicketOut:
    return TicketOut(
        id=t.id,
        code=t.code,
        table_number=t.table.number,
        waiter=t.waiter.display_name,
        covers=t.covers,
        apericena=t.apericena,
        notes=t.notes,
        status=t.status,
        created_at=t.created_at,
        items=[
            TicketItemOut(
                id=it.id,
                name=it.name,
                qty=it.qty,
                note=it.note,
                station=it.station,
                done=it.done,
            )
            for it in t.items
        ],
    )


@router.post("/auth/login", response_model=TokenOut)
async def login(payload: LoginIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.username == payload.username))
    u = res.scalar_one_or_none()
    if u is None or not verify_password(payload.password, u.password_hash) or not u.is_active:
        raise HTTPException(status_code=401, detail="Credenziali non valide")
    token = create_access_token(sub=u.username, role=u.role)
    return TokenOut(access_token=token)


@router.get("/me", response_model=UserOut)
async def me(token=Depends(get_token), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.username == token["sub"]))
    u = res.scalar_one()
    return UserOut(id=u.id, username=u.username, display_name=u.display_name, role=u.role)


@router.get("/users", response_model=list[UserOut])
async def list_users(token=Depends(get_token), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.is_active == True))
    return [UserOut(id=u.id, username=u.username, display_name=u.display_name, role=u.role) for u in res.scalars().all()]


@router.post("/tickets", response_model=TicketOut)
async def create_ticket(payload: TicketCreateIn, token=Depends(get_token), db: AsyncSession = Depends(get_db)):
    # waiter can create tickets
    if token["role"] not in {"waiter", "cashier", "admin"}:
        raise HTTPException(status_code=403, detail="Non autorizzato")

    res_table = await db.execute(select(Table).where(Table.number == payload.table_number))
    table = res_table.scalar_one_or_none()
    if table is None:
        table = Table(number=payload.table_number)
        db.add(table)
        await db.flush()

    res_waiter = await db.execute(select(User).where(User.username == payload.waiter_username))
    waiter = res_waiter.scalar_one_or_none()
    if waiter is None:
        raise HTTPException(status_code=400, detail="Cameriere non trovato")

    # simple code generator: 5 digits incremental
    res_max = await db.execute(select(func.coalesce(func.max(Ticket.id), 0)))
    next_id = int(res_max.scalar_one()) + 1
    code = f"{next_id:05d}"

    t = Ticket(
        code=code,
        table_id=table.id,
        waiter_id=waiter.id,
        covers=payload.covers,
        apericena=payload.apericena,
        notes=payload.notes,
        status="OPEN",
        updated_at=datetime.utcnow(),
    )
    db.add(t)
    await db.flush()

    for it in payload.items:
        db.add(TicketItem(ticket_id=t.id, name=it.name, qty=it.qty, note=it.note, station=it.station, done=False))

    await db.commit()

    # reload with relationships
    res = await db.execute(
        select(Ticket).where(Ticket.id == t.id)
        .options(
            # joined loads are not essential for minimal example
        )
    )
    # We need relationships; simplest: refresh then lazy load with selectin
    await db.refresh(t)
    await db.refresh(table)
    await db.refresh(waiter)
    # load items
    res_items = await db.execute(select(TicketItem).where(TicketItem.ticket_id == t.id))
    t.items = list(res_items.scalars().all())
    t.table = table
    t.waiter = waiter

    out = ticket_to_out(t)
    await hub.broadcast("ticket.created", out.model_dump(mode="json"), roles={"bar", "waiter", "cashier", "admin"})
    return out


@router.get("/tickets", response_model=list[TicketOut])
async def list_tickets(status: str | None = None, token=Depends(get_token), db: AsyncSession = Depends(get_db)):
    q = select(Ticket).order_by(Ticket.created_at.desc())
    if status:
        q = q.where(Ticket.status == status)
    res = await db.execute(q)
    tickets = res.scalars().all()

    outs: list[TicketOut] = []
    for t in tickets:
        await db.refresh(t)
        # fetch rels
        table = (await db.execute(select(Table).where(Table.id == t.table_id))).scalar_one()
        waiter = (await db.execute(select(User).where(User.id == t.waiter_id))).scalar_one()
        items = (await db.execute(select(TicketItem).where(TicketItem.ticket_id == t.id))).scalars().all()
        t.table = table
        t.waiter = waiter
        t.items = list(items)
        outs.append(ticket_to_out(t))
    return outs


@router.patch("/ticket-items/{item_id}/done", response_model=TicketOut)
async def set_item_done(item_id: int, done: bool = True, token=Depends(get_token), db: AsyncSession = Depends(get_db)):
    if token["role"] not in {"bar", "admin"}:
        raise HTTPException(status_code=403, detail="Non autorizzato")

    res = await db.execute(select(TicketItem).where(TicketItem.id == item_id))
    it = res.scalar_one_or_none()
    if it is None:
        raise HTTPException(status_code=404, detail="Item non trovato")
    it.done = bool(done)

    # update ticket status
    res_t = await db.execute(select(Ticket).where(Ticket.id == it.ticket_id))
    t = res_t.scalar_one()
    t.updated_at = datetime.utcnow()

    # ticket READY when all items done
    res_items = await db.execute(select(TicketItem).where(TicketItem.ticket_id == t.id))
    items = list(res_items.scalars().all())
    if items and all(x.done for x in items):
        t.status = "READY"

    await db.commit()

    table = (await db.execute(select(Table).where(Table.id == t.table_id))).scalar_one()
    waiter = (await db.execute(select(User).where(User.id == t.waiter_id))).scalar_one()
    t.table = table
    t.waiter = waiter
    t.items = items

    out = ticket_to_out(t)
    await hub.broadcast("ticket.updated", out.model_dump(mode="json"), roles={"bar", "waiter", "cashier", "admin"})
    return out


@router.post("/calls", response_model=CallOut)
async def create_call(payload: CallCreateIn, token=Depends(get_token), db: AsyncSession = Depends(get_db)):
    # bar/cashier can call waiter
    if token["role"] not in {"bar", "cashier", "admin"}:
        raise HTTPException(status_code=403, detail="Non autorizzato")

    # default target role: waiter
    c = Call(from_role=token["role"], to_role="waiter", to_user_id=payload.to_user_id, ticket_id=payload.ticket_id, message=payload.message)
    db.add(c)
    await db.commit()
    out = CallOut(
        id=c.id,
        from_role=c.from_role,
        to_role=c.to_role,
        to_user_id=c.to_user_id,
        ticket_id=c.ticket_id,
        message=c.message,
        status=c.status,
        created_at=c.created_at,
    )
    await hub.broadcast("call.created", out.model_dump(mode="json"), roles={"waiter", "admin"})
    return out


@router.post("/prints/ticket/{ticket_id}")
async def print_ticket(ticket_id: int, printer_name: str = "BAR_PRINTER", token=Depends(get_token), db: AsyncSession = Depends(get_db)):
    if token["role"] not in {"bar", "cashier", "admin"}:
        raise HTTPException(status_code=403, detail="Non autorizzato")

    printer = (await db.execute(select(Printer).where(Printer.name == printer_name))).scalar_one_or_none()
    if printer is None:
        raise HTTPException(status_code=404, detail="Stampante non trovata")

    t = (await db.execute(select(Ticket).where(Ticket.id == ticket_id))).scalar_one_or_none()
    if t is None:
        raise HTTPException(status_code=404, detail="Comanda non trovata")

    table = (await db.execute(select(Table).where(Table.id == t.table_id))).scalar_one()
    waiter = (await db.execute(select(User).where(User.id == t.waiter_id))).scalar_one()
    items = (await db.execute(select(TicketItem).where(TicketItem.ticket_id == t.id))).scalars().all()

    text_lines = [
        "--- COMANDA ---",
        f"#{t.code}  Tavolo {table.number}",
        f"Cameriere: {waiter.display_name}",
        "",
    ]
    for it in items:
        q = f"x{it.qty}" if it.qty != 1 else ""
        note = f" ({it.note})" if it.note else ""
        text_lines.append(f"- {it.name} {q}{note}")
    if t.notes:
        text_lines += ["", f"NOTE: {t.notes}"]
    text_lines.append("\n")

    payload_text = "\n".join(text_lines)

    job = PrintJob(printer_id=printer.id, ticket_id=t.id, payload_text=payload_text, status="QUEUED")
    db.add(job)
    await db.commit()

    # send to adapter
    res = await adapter.print_text(printer.connection, payload_text)
    job.status = "SENT" if res.ok else "ERROR"
    job.error = "" if res.ok else res.error
    await db.commit()

    await hub.broadcast("printjob.updated", {"id": job.id, "status": job.status, "error": job.error}, roles={"bar", "cashier", "admin"})
    return {"ok": res.ok, "job_id": job.id, "status": job.status, "error": job.error}
