import asyncio
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient
from app.config import get_settings

settings = get_settings()
SAMPLE_LIBRARIES = [
    {
        'name': 'Express',
        'ecosystem': 'npm',
        'description': 'Fast, unopinionated, minimalist web framework for Node.js',
        'repository_url': 'https://github.com/expressjs/express',
        'versions': [
            {
                'version': '4.19.2',
                'license_name': 'MIT',
                'license_url': 'https://opensource.org/licenses/MIT',
                'created_at': datetime.utcnow()
            },
            {
                'version': '5.0.0-beta.4',
                'license_name': 'MIT',
                'license_url': 'https://opensource.org/licenses/MIT',
                'created_at': datetime.utcnow()
            }
        ]
    },
    {
        'name': 'Spring Boot',
        'ecosystem': 'maven',
        'description': 'Spring-based microservice framework',
        'repository_url': 'https://github.com/spring-projects/spring-boot',
        'versions': [
            {
                'version': '3.2.5',
                'license_name': 'Apache-2.0',
                'license_url': 'https://www.apache.org/licenses/LICENSE-2.0',
                'created_at': datetime.utcnow()
            }
        ]
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
