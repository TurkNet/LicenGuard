import asyncio
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient
from app.config import get_settings

settings = get_settings()
SAMPLE_LIBRARIES = [
  {
    "name": "pydantic",
    "ecosystem": "Python",
    "description": "Veri doğrulama ve ayarlar yönetimi için Python veri sınıfı oluşturma aracı.",
    "repository_url": "https://github.com/pydantic/pydantic",
    "officialSite": "https://docs.pydantic.dev/",
    "versions": [
      {
        "version": "2.7.1",
        "license_name": "MIT",
        "license_url": "https://github.com/pydantic/pydantic/blob/main/LICENSE",
        "notes": null,
        "license_summary": [
          {
            "summary": "Ticari kullanıma izin verir.",
            "emoji": "🟢"
          },
          {
            "summary": "Değiştirilmiş versiyonları dağıtabilirsiniz.",
            "emoji": "🟢"
          },
          {
            "summary": "Lisans ve telif hakkı bildirimi gereklidir.",
            "emoji": "🟢"
          }
        ],
        "evidence": [
          "https://docs.pydantic.dev/",
          "https://github.com/pydantic/pydantic",
          "https://pypi.org/project/pydantic/"
        ],
        "confidence": 1,
        "risk_level": "low",
        "risk_score": 15
      },
      {
        "version": "2.8.2",
        "license_name": "MIT",
        "license_url": "https://github.com/pydantic/pydantic/blob/main/LICENSE",
        "notes": null,
        "license_summary": [
          {
            "summary": "Ticari kullanıma izin verir.",
            "emoji": "🟢"
          },
          {
            "summary": "Değiştirilmiş versiyonları dağıtabilirsiniz.",
            "emoji": "🟢"
          },
          {
            "summary": "Lisans ve telif hakkı bildirimi gereklidir.",
            "emoji": "🟢"
          }
        ],
        "evidence": [
          "https://docs.pydantic.dev/",
          "https://github.com/pydantic/pydantic"
        ],
        "confidence": 1,
        "risk_level": "low",
        "risk_score": 15
      }
    ],
    "created_at": {
      "$date": "2025-11-18T13:14:09.539Z"
    },
    "updated_at": {
      "$date": "2025-11-18T14:08:54.950Z"
    }
  },
  {
    "name": "pydantic-settings",
    "ecosystem": "Python",
    "description": "Pydantic ayarlarını yönetmek için bir kütüphane.",
    "repository_url": "https://github.com/pydantic/pydantic-settings",
    "officialSite": "https://pydantic-docs.helpmanual.io/en/stable/",
    "versions": [
      {
        "version": "2.2.1",
        "license_name": "MIT",
        "license_url": "https://github.com/pydantic/pydantic-settings/blob/main/LICENSE",
        "notes": null,
        "license_summary": [
          {
            "summary": "Ticari kullanıma izin verir.",
            "emoji": "🟢"
          },
          {
            "summary": "Değiştirilmiş versiyonları dağıtabilirsiniz.",
            "emoji": "🟢"
          },
          {
            "summary": "Lisans ve telif hakkı bildirimi gereklidir.",
            "emoji": "🟢"
          }
        ],
        "evidence": [
          "https://pypi.org/project/pydantic-settings/",
          "https://github.com/pydantic/pydantic-settings"
        ],
        "confidence": 1,
        "risk_level": "low",
        "risk_score": 15
      }
    ],
    "created_at": {
      "$date": "2025-11-18T13:14:18.705Z"
    },
    "updated_at": {
      "$date": "2025-11-18T13:14:18.705Z"
    }
  }
]


async def main():
    client = AsyncIOMotorClient(settings.mongodb_uri)
    db = client[settings.database_name]
    await db.drop_collection('libraries')
    for library in SAMPLE_LIBRARIES:
        now = datetime.utcnow()
        library['created_at'] = now
        library['updated_at'] = now
        await db['libraries'].insert_one(library)
    print('Seed complete!')
    client.close()


if __name__ == '__main__':
    asyncio.run(main())
