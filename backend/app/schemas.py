from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from .models import CallType, OrderStatus, Role

class Token(BaseModel):
	access_token: str
	token_type: str = "bearer"

class UserOut(BaseModel):
	id: int
	username: str
	display_name: str
	role: Role

class LoginIn(BaseModel):
	username: str
	password: str

class MenuItemOut(BaseModel):
	id: int
	sku: str
	name: str
	category: str
	price: float

class OrderItemOut(BaseModel):
	id: int
	line_no: int
	menu_item_id: int
	name: str
	note: Optional[str] = None
	qty: int
	is_done: bool

class OrderOut(BaseModel):
	id: int
	public_id: str
	table_id: int
	table_number: int
	waiter_id: int
	waiter_name: str
	covers: int
	apericena: int
	note: Optional[str] = None
	status: OrderStatus
	created_at: datetime
	ready_at: Optional[datetime] = None
	items: List[OrderItemOut]

class CreateOrderItemIn(BaseModel):
	menu_item_id: int
	qty: int = Field(ge=1, le=50)
	note: Optional[str] = None

class CreateOrderIn(BaseModel):
	table_number: int = Field(ge=1, le=500)
	covers: int = Field(default=0, ge=0, le=50)
	apericena: int = Field(default=0, ge=0, le=50)
	note: Optional[str] = None
	items: List[CreateOrderItemIn]

class UpdateItemDoneIn(BaseModel):
	is_done: bool

class CallIn(BaseModel):
	call_type: CallType
	to_user_id: Optional[int] = None
	table_number: Optional[int] = None
	order_public_id: Optional[str] = None
	message: Optional[str] = None

class CallOut(BaseModel):
	id: int
	call_type: CallType
	from_user_id: Optional[int]
	to_user_id: Optional[int]
	table_id: Optional[int]
	order_id: Optional[int]
	message: Optional[str]
	is_ack: bool
	created_at: datetime
	acked_at: Optional[datetime] = None
