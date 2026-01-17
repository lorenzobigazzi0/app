import os
from pydantic import BaseModel

class Settings(BaseModel):
	DATABASE_URL: str = os.getenv(
		"DATABASE_URL",
		"postgresql+asyncpg://cassa:cassa@localhost:5432/cassa",
	)
	JWT_SECRET: str = os.getenv("JWT_SECRET", "change-me")
	JWT_ALG: str = os.getenv("JWT_ALG", "HS256")
	JWT_EXPIRE_MIN: int = int(os.getenv("JWT_EXPIRE_MIN", "720"))
	CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "*")

settings = Settings()
