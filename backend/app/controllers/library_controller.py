from datetime import datetime
import re
from typing import List
from bson import ObjectId
from fastapi import HTTPException
from ..database import get_database
from ..models.library import (
    LibraryCreate,
    LibraryDocument,
    LibraryDiscoveryReport,
    LibrarySearchResponse,
    LibraryUpdate,
    VersionModel
)
from ..services.mcp_client import MCPClientError, get_mcp_http_client
from pymongo import ReturnDocument


collection = get_database()['libraries']


async def list_libraries() -> List[LibraryDocument]:
    cursor = collection.find().sort('updated_at', -1)
    docs = [LibraryDocument(**doc) async for doc in cursor]
    return docs

def _parse_package_query(value: str) -> tuple[str | None, str | None]:
    text = value.strip().strip('"')
    patterns = [
        r'"?([\w.\-@/]+)"?\s*:\s*"?(?:\^)?([\w.\-]+)"?',  # "name": "^1.2.3"
        r'([\w.\-@/]+)==([\w.\-]+)',                     # name==1.2.3 (Python)
        r'([\w.\-@/]+)=([\w.\-]+)',                      # name=1.2.3
        r'([\w.\-@/]+)@([\w.\-]+)',                      # name@1.2.3
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return m.group(1), m.group(2).lstrip('^')
    parts = text.split(':')
    if len(parts) == 2:
        pkg_name = parts[0].strip()
        pkg_version = parts[1].strip().lstrip('^')
        return pkg_name or None, pkg_version or None
    return None, None


def _build_terms(query: str, name_token: str | None, version_token: str | None) -> set[str]:
    cleaned = query.strip('"').strip()
    terms = {query, cleaned}
    if name_token:
        terms.add(name_token)
    if version_token:
        terms.add(version_token)
    if query.startswith('^'):
        terms.add(query.lstrip('^'))
    if '@' in query:
        terms.add(query)
    return terms


async def _search_mongo(query: str, name_token: str | None, version_token: str | None) -> List[LibraryDocument]:
    terms = _build_terms(query, name_token, version_token)
    regexes = [{'name': {'$regex': re.escape(term), '$options': 'i'}} for term in terms]
    regexes += [{'versions.version': {'$regex': re.escape(term), '$options': 'i'}} for term in terms]
    cursor = collection.find({'$or': regexes}).sort('updated_at', -1)
    docs = [LibraryDocument(**doc) async for doc in cursor]
    return docs


async def search_libraries_local(query: str) -> LibrarySearchResponse:
    name_token, version_token = _parse_package_query(query)
    docs = await _search_mongo(query, name_token, version_token)
    return LibrarySearchResponse(source='mongo', results=docs)


async def search_libraries(query: str) -> LibrarySearchResponse:
    name_token, version_token = _parse_package_query(query)
    docs = await _search_mongo(query, name_token, version_token)
    if docs:
        return LibrarySearchResponse(source='mongo', results=docs)

    client = get_mcp_http_client()
    if not client:
        return LibrarySearchResponse(source='mongo', results=[])

    try:
        report_name = f'{name_token}@{version_token}' if name_token and version_token else (name_token or query)
        report = await client.discover_library({'name': report_name})
    except MCPClientError as error:
        print(f'[search_libraries] MCP lookup failed for "{query}": {error}')
        return LibrarySearchResponse(source='mongo', results=[])

    if not report:
        return LibrarySearchResponse(source='mcp', discovery=None)

    if 'query' not in report:
        report['query'] = {'name': query}

    discovery = LibraryDiscoveryReport(**report)
    return LibrarySearchResponse(source='mcp', discovery=discovery)


async def get_library(library_id: str) -> LibraryDocument:
    doc = await collection.find_one({'_id': ObjectId(library_id)})
    if not doc:
        raise HTTPException(status_code=404, detail='Library not found')
    return LibraryDocument(**doc)


async def create_library(payload: LibraryCreate) -> LibraryDocument:
    document = payload.model_dump(by_alias=True)
    now = datetime.utcnow()
    document['created_at'] = now
    document['updated_at'] = now
    result = await collection.insert_one(document)
    return await get_library(str(result.inserted_id))


async def update_library(library_id: str, payload: LibraryUpdate) -> LibraryDocument:
    update_data = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    update_data['updated_at'] = datetime.utcnow()
    result = await collection.find_one_and_update(
        {'_id': ObjectId(library_id)},
        {'$set': update_data},
        return_document=ReturnDocument.AFTER
    )
    if not result:
        raise HTTPException(status_code=404, detail='Library not found')
    return LibraryDocument(**result)


async def add_version(library_id: str, payload: VersionModel) -> LibraryDocument:
    payload.created_at = datetime.utcnow()
    result = await collection.find_one_and_update(
        {'_id': ObjectId(library_id)},
        {
            '$push': {'versions': payload.model_dump()},
            '$set': {'updated_at': datetime.utcnow()}
        },
        return_document=ReturnDocument.AFTER
    )
    if not result:
        raise HTTPException(status_code=404, detail='Library not found')
    return LibraryDocument(**result)
