from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_db
from .models import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(password: str) -> str:
	return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
	return pwd_context.verify(password, password_hash)


def create_access_token(sub: str) -> str:
	now = datetime.now(timezone.utc)
	exp = now + timedelta(minutes=settings.JWT_EXPIRE_MIN)
	payload = {"sub": sub, "iat": int(now.timestamp()), "exp": int(exp.timestamp())}
	return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


async def get_current_user(
	token: str = Depends(oauth2_scheme),
	db: AsyncSession = Depends(get_db),
) -> User:
	cred_exc = HTTPException(
		status_code=status.HTTP_401_UNAUTHORIZED,
		detail="Could not validate credentials",
		headers={"WWW-Authenticate": "Bearer"},
	)
	try:
		payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
		sub: Optional[str] = payload.get("sub")
		if not sub:
			raise cred_exc
	except JWTError:
		raise cred_exc

	res = await db.execute(select(User).where(User.username == sub, User.is_active == True))
	user = res.scalar_one_or_none()
	if not user:
		raise cred_exc
	return user
