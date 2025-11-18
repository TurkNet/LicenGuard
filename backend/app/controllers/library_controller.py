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


async def list_libraries(limit: int | None = None) -> List[LibraryDocument]:
    cursor = collection.find().sort('updated_at', -1)
    if limit and limit > 0:
        cursor = cursor.limit(limit)
    docs = [LibraryDocument(**doc) async for doc in cursor]
    return docs

def _parse_package_query(value: str) -> tuple[str | None, str | None]:
    text = value.strip().strip('"')
    patterns = [
        r'"?([\w.\-@/]+)"?\s*:\s*"?(?:\^)?([\w.\-]+)"?',  # "name": "^1.2.3"
        r'([\w.\-@/]+)==([\w.\-]+)',                     # name==1.2.3 (Python)
        r'([\w.\-@/]+)=([\w.\-]+)',                      # name=1.2.3
        r'([\w.\-@/]+)@([\w.\-]+)',                      # name@1.2.3
        r'([\w.\-@/]+)\s+([\w.\-]+)',                    # name 1.2.3 (space-separated)
        r'([\w.\-@/]+)\s*,\s*\^?([\w.\-]+)',             # name , ^1.2.3
        r'([\w.\-@/]+)\s+\^([\w.\-]+)',                  # name ^1.2.3
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
    docs: List[LibraryDocument] = []
    seen_ids = set()

    # If version is present, try an exact name+version match first and keep them
    if name_token and version_token:
        version_norm = version_token.lstrip('v')
        version_regex = f'^v?{re.escape(version_norm)}$'
        exact_cursor = collection.find({
            'name': {'$regex': f'^{re.escape(name_token)}$', '$options': 'i'},
            'versions.version': {'$regex': version_regex, '$options': 'i'}
        }).sort('updated_at', -1)
        exact_docs = [LibraryDocument(**doc) async for doc in exact_cursor]
        for d in exact_docs:
            if d.id not in seen_ids:
                seen_ids.add(d.id)
                docs.append(d)

    terms = _build_terms(query, name_token, version_token)
    regexes = [{'name': {'$regex': re.escape(term), '$options': 'i'}} for term in terms]
    regexes += [{'versions.version': {'$regex': re.escape(term), '$options': 'i'}} for term in terms]
    cursor = collection.find({'$or': regexes}).sort('updated_at', -1)
    broad_docs = [LibraryDocument(**doc) async for doc in cursor]
    for d in broad_docs:
        if d.id not in seen_ids:
            seen_ids.add(d.id)
            docs.append(d)
    return docs


async def search_libraries_local(query: str) -> LibrarySearchResponse:
    name_token, version_token = _parse_package_query(query)
    docs = await _search_mongo(query, name_token, version_token)
    ts = datetime.utcnow().isoformat()
    print(f'{ts} [search_libraries_local] request', {'q': query, 'name_token': name_token, 'version_token': version_token})
    if version_token:
        ver_norm = version_token.lstrip('v').lower()
        filtered = [
            doc for doc in docs
            if any((v.version or '').lstrip('v').lower() == ver_norm for v in doc.versions or [])
        ]
        if filtered:
            docs = filtered
        else:
            docs = []
    print(f'{ts} [search_libraries_local] response', {'count': len(docs), 'results': [doc.model_dump() for doc in docs]})
    return LibrarySearchResponse(source='mongo', results=docs)


async def search_libraries(query: str) -> LibrarySearchResponse:
    name_token, version_token = _parse_package_query(query)
    ts_req = datetime.utcnow().isoformat()
    print(f'{ts_req} [search_libraries] request', {'q': query, 'name_token': name_token, 'version_token': version_token})
    docs = await _search_mongo(query, name_token, version_token)
    fallback_to_mcp = False
    if version_token:
        ver_norm = version_token.lstrip('v').lower()
        filtered = [
            doc for doc in docs
            if any((v.version or '').lstrip('v').lower() == ver_norm for v in doc.versions or [])
        ]
        if filtered:
            docs = filtered
        else:
            docs = []
            fallback_to_mcp = True
    if docs:
        ts_res = datetime.utcnow().isoformat()
        print(f'{ts_res} [search_libraries] mongo response', {'count': len(docs), 'results': [doc.model_dump() for doc in docs]})
        return LibrarySearchResponse(source='mongo', results=docs)

    client = get_mcp_http_client()
    if not client:
        print(f'{datetime.utcnow().isoformat()} [search_libraries] MCP client not configured')
        return LibrarySearchResponse(source='mcp', results=[])

    try:
        report_name = f'{name_token}@{version_token}' if name_token and version_token else (name_token or query)
        report = await client.discover_library({'name': report_name})
    except MCPClientError as error:
        print(f'{datetime.utcnow().isoformat()} [search_libraries] MCP lookup failed for "{query}": {error}')
        return LibrarySearchResponse(source='mcp', results=[])
    except Exception as exc:
        print(f'{datetime.utcnow().isoformat()} [search_libraries] unexpected error for "{query}": {exc}')
        return LibrarySearchResponse(source='mcp', results=[])

    if not report:
        return LibrarySearchResponse(source='mcp', discovery=None)

    if 'query' not in report:
        report['query'] = {'name': query}

    # If MCP short-circuited with Mongo results, return them immediately (respect version if provided)
    if isinstance(report, dict) and isinstance(report.get('results'), list) and report.get('source') == 'mongo':
        mongo_docs: List[LibraryDocument] = []
        for item in report['results']:
            try:
                mongo_docs.append(LibraryDocument(**item))
            except Exception:
                continue
        if version_token:
            ver_norm = version_token.lstrip('v').lower()
            mongo_docs = [
                doc for doc in mongo_docs
                if any((v.version or '').lstrip('v').lower() == ver_norm for v in doc.versions or [])
            ]
        print(f'{datetime.utcnow().isoformat()} [search_libraries] mcp→mongo passthrough', {'count': len(mongo_docs), 'results': [doc.model_dump() for doc in mongo_docs]})
        if mongo_docs:
            return LibrarySearchResponse(source='mongo', results=mongo_docs, discovery=None)

    # Normalize matches to list for pydantic
    if isinstance(report.get('matches'), dict):
        report['matches'] = [report['matches']]
    elif report.get('matches') is None:
        report['matches'] = []

    discovery = LibraryDiscoveryReport(**report)

    # Convert discovery matches to LibraryDocument shape for results
    converted_results: List[LibraryDocument] = []
    for match in discovery.matches:
        try:
            converted_results.append(
                LibraryDocument(
                    name=match.name or query,
                    ecosystem=match.ecosystem or (report.get('query') or {}).get('ecosystem') or 'unknown',
                    description=match.description,
                    repository_url=match.repository_url,
                    officialSite=match.officialSite,
                    versions=match.versions,
                )
            )
        except Exception:
            continue

    print(f'{datetime.utcnow().isoformat()} [search_libraries] mcp response', {
        'discovery': discovery.model_dump(),
        'results': [doc.model_dump() for doc in converted_results]
    })
    return LibrarySearchResponse(source='mcp', results=converted_results, discovery=discovery)


async def get_library(library_id: str) -> LibraryDocument:
    doc = await collection.find_one({'_id': ObjectId(library_id)})
    if not doc:
        raise HTTPException(status_code=404, detail='Library not found')
    return LibraryDocument(**doc)


async def create_library(payload: LibraryCreate) -> LibraryDocument:
    try:
        # Upsert by name + ecosystem to avoid duplicate library records
        now = datetime.utcnow()
        document = payload.model_dump(by_alias=True)
        document['created_at'] = now
        document['updated_at'] = now

        ts = datetime.utcnow().isoformat()
        print(f'{ts} [create_library] request', document)

        existing = await collection.find_one({'name': payload.name, 'ecosystem': payload.ecosystem})
        if existing:
            # Update metadata if provided
            update_fields = {}
            if payload.description:
                update_fields['description'] = payload.description
            if payload.repository_url:
                update_fields['repository_url'] = payload.repository_url
            if getattr(payload, 'officialSite', None):
                update_fields['officialSite'] = payload.officialSite
            if payload.ecosystem:
                update_fields['ecosystem'] = payload.ecosystem

            # If version already exists, skip adding; else push new version
            new_version = payload.versions[0] if payload.versions else None
            if new_version:
                version_exists = any(v.get('version') == new_version.version for v in existing.get('versions', []))
                if not version_exists:
                    update_fields['versions'] = existing.get('versions', []) + [new_version.model_dump()]

            update_fields['updated_at'] = now
            await collection.update_one({'_id': existing['_id']}, {'$set': update_fields})
            updated_doc = await get_library(str(existing['_id']))
            print(f'{datetime.utcnow().isoformat()} [create_library] update response', updated_doc.model_dump())
            return updated_doc

        result = await collection.insert_one(document)
        created = await get_library(str(result.inserted_id))
        print(f'{datetime.utcnow().isoformat()} [create_library] insert response', created.model_dump())
        return created
    except Exception as exc:
        print(f'{datetime.utcnow().isoformat()} [create_library] error', {'error': str(exc)})
        raise


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
