from motor.motor_asyncio import AsyncIOMotorClient
from .config import get_settings


settings = get_settings()
_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.mongodb_uri)
    return _client


def get_database():
    client = get_client()
    return client[settings.database_name]
