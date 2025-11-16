from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    mongodb_uri: str = Field('mongodb://localhost:27017/licenguard', env='MONGODB_URI')
    database_name: str = Field('licenguard', env='MONGODB_DB')
    mcp_http_url: str | None = Field(None, env='MCP_HTTP_URL')

    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
