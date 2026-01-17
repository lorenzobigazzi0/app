from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import User, Table, Printer
from .security import hash_password

async def seed_if_empty(db: AsyncSession) -> None:
    # Users
    res = await db.execute(select(User).limit(1))
    if res.scalar_one_or_none() is None:
        users = [
            User(username="emma",  password_hash=hash_password("1234"), display_name="Emma", role="waiter"),
            User(username="luca",  password_hash=hash_password("1234"), display_name="Luca", role="waiter"),
            User(username="marco", password_hash=hash_password("1234"), display_name="Marco", role="cashier"),
            User(username="bar",   password_hash=hash_password("1234"), display_name="Bar", role="bar"),
            User(username="admin", password_hash=hash_password("admin"), display_name="Admin", role="admin"),
        ]
        db.add_all(users)

    # Tables 1..30
    res2 = await db.execute(select(Table).limit(1))
    if res2.scalar_one_or_none() is None:
        db.add_all([Table(number=i, name=None) for i in range(1, 31)])

    # Printers (demo)
    res3 = await db.execute(select(Printer).limit(1))
    if res3.scalar_one_or_none() is None:
        db.add_all([
            Printer(name="BAR_PRINTER", kind="cups", connection="BAR_PRINTER", station="BAR"),
            Printer(name="CASSA_PRINTER", kind="cups", connection="CASSA_PRINTER", station="CASSA"),
        ])

    await db.commit()
