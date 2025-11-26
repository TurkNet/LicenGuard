from functools import lru_cache
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_PATH = Path(__file__).resolve().parent.parent / '.env'


class Settings(BaseSettings):
    mongodb_uri: str = Field('mongodb://localhost:27017/licenguard', env='MONGODB_URI')
    database_name: str = Field('licenguard', env='MONGODB_DB')
    mcp_http_url: str | None = Field(None, env='MCP_HTTP_URL')

    model_config = SettingsConfigDict(
        env_file=str(ENV_PATH),
        env_file_encoding='utf-8',
        extra='ignore'
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
