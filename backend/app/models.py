import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

class Role(str, enum.Enum):
	ADMIN = "ADMIN"
	BAR = "BAR"
	WAITER = "WAITER"
	CASHIER = "CASHIER"

class OrderStatus(str, enum.Enum):
	OPEN = "OPEN"
	READY = "READY"
	PRINTED = "PRINTED"
	CLOSED = "CLOSED"

class CallType(str, enum.Enum):
	CALL_WAITER = "CALL_WAITER"
	CALL_BARMAN = "CALL_BARMAN"

class User(Base):
	__tablename__ = "users"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
	display_name: Mapped[str] = mapped_column(String(128))
	role: Mapped[Role] = mapped_column(Enum(Role), index=True)
	password_hash: Mapped[str] = mapped_column(String(255))
	is_active: Mapped[bool] = mapped_column(Boolean, default=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

class Table(Base):
	__tablename__ = "tables"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	number: Mapped[int] = mapped_column(Integer, unique=True, index=True)
	name: Mapped[str | None] = mapped_column(String(128), nullable=True)
	is_open: Mapped[bool] = mapped_column(Boolean, default=False)
	opened_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
	opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
	closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

	orders: Mapped[list["Order"]] = relationship(back_populates="table")

class MenuItem(Base):
	__tablename__ = "menu_items"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	sku: Mapped[str] = mapped_column(String(64), unique=True, index=True)
	name: Mapped[str] = mapped_column(String(255))
	category: Mapped[str] = mapped_column(String(128), index=True)
	price: Mapped[float] = mapped_column(Numeric(10, 2))
	is_active: Mapped[bool] = mapped_column(Boolean, default=True)

class Order(Base):
	__tablename__ = "orders"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	public_id: Mapped[str] = mapped_column(String(16), unique=True, index=True)
	table_id: Mapped[int] = mapped_column(ForeignKey("tables.id"), index=True)
	waiter_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
	covers: Mapped[int] = mapped_column(Integer, default=0)
	apericena: Mapped[int] = mapped_column(Integer, default=0)
	note: Mapped[str | None] = mapped_column(Text, nullable=True)
	status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus), default=OrderStatus.OPEN, index=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
	ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
	closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

	table: Mapped[Table] = relationship(back_populates="orders")
	items: Mapped[list["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")

class OrderItem(Base):
	__tablename__ = "order_items"
	__table_args__ = (UniqueConstraint("order_id", "line_no", name="uq_order_line"),)

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
	line_no: Mapped[int] = mapped_column(Integer)
	menu_item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id"), index=True)
	name: Mapped[str] = mapped_column(String(255))
	note: Mapped[str | None] = mapped_column(String(255), nullable=True)
	qty: Mapped[int] = mapped_column(Integer, default=1)
	is_done: Mapped[bool] = mapped_column(Boolean, default=False)

	order: Mapped[Order] = relationship(back_populates="items")
	menu_item: Mapped[MenuItem] = relationship()

class CallEvent(Base):
	__tablename__ = "call_events"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	call_type: Mapped[CallType] = mapped_column(Enum(CallType), index=True)
	from_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
	to_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
	table_id: Mapped[int | None] = mapped_column(ForeignKey("tables.id"), nullable=True)
	order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
	message: Mapped[str | None] = mapped_column(Text, nullable=True)
	is_ack: Mapped[bool] = mapped_column(Boolean, default=False)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
	acked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class Printer(Base):
	__tablename__ = "printers"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	name: Mapped[str] = mapped_column(String(128), unique=True)
	kind: Mapped[str] = mapped_column(String(32))  # cups | escpos | dummy
	connection: Mapped[str] = mapped_column(String(255))  # e.g. CUPS queue name or ip:port
	is_active: Mapped[bool] = mapped_column(Boolean, default=True)

class PrintJob(Base):
	__tablename__ = "print_jobs"

	id: Mapped[int] = mapped_column(Integer, primary_key=True)
	order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
	printer_id: Mapped[int] = mapped_column(ForeignKey("printers.id"), index=True)
	payload_text: Mapped[str] = mapped_column(Text)
	status: Mapped[str] = mapped_column(String(32), default="QUEUED", index=True)  # QUEUED|SENT|ERROR
	error: Mapped[str | None] = mapped_column(Text, nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
	sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
