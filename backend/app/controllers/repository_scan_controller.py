from datetime import datetime
from typing import List
import re
from bson import ObjectId
from fastapi import HTTPException
from pymongo import ReturnDocument
from ..database import get_database
from ..models.repository_scan import (
    RepositoryScanCreate,
    RepositoryScanDocument,
    RepositoryScanUpdate
)


collection = get_database()['repository_scans']


async def list_repository_scans(limit: int | None = None) -> List[RepositoryScanDocument]:
    cursor = collection.find().sort('updatedAt', -1)
    if limit and limit > 0:
        cursor = cursor.limit(limit)
    docs = [RepositoryScanDocument(**doc) async for doc in cursor]
    return docs


async def get_repository_scan(scan_id: str) -> RepositoryScanDocument:
    try:
        oid = ObjectId(scan_id)
    except Exception:
        raise HTTPException(status_code=400, detail='Invalid scan id')
    doc = await collection.find_one({'_id': oid})
    if not doc:
        raise HTTPException(status_code=404, detail='Scan not found')
    return RepositoryScanDocument(**doc)


async def create_repository_scan(payload: RepositoryScanCreate) -> RepositoryScanDocument:
    data = payload.model_dump(by_alias=True)
    now = datetime.utcnow()
    data['createdAt'] = data.get('createdAt') or now
    data['updatedAt'] = now

    query = {'repository_url': data.get('repository_url')}
    if not query['repository_url']:
        query = {
            'repository_platform': data.get('repository_platform'),
            'repository_name': data.get('repository_name')
        }

    # Upsert: replace dependencies with latest scan and refresh metadata
    doc = await collection.find_one_and_update(
        query,
        {
            '$set': {
                'repository_url': data.get('repository_url'),
                'repository_platform': data.get('repository_platform'),
                'repository_name': data.get('repository_name'),
                'dependencies': data.get('dependencies', []),
                'updatedAt': data['updatedAt'],
            },
            '$setOnInsert': {'createdAt': data.get('createdAt')},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER
    )

    # If upsert inserted, doc may be None in Motor <3.4; fetch explicitly
    if doc is None:
        doc = await collection.find_one(query)
    return RepositoryScanDocument(**doc)


async def update_repository_scan(scan_id: str, payload: RepositoryScanUpdate) -> RepositoryScanDocument:
    try:
        oid = ObjectId(scan_id)
    except Exception:
        raise HTTPException(status_code=400, detail='Invalid scan id')
    update_data = {k: v for k, v in payload.model_dump(by_alias=True).items() if v is not None}
    if not update_data:
        doc = await collection.find_one({'_id': oid})
        if not doc:
            raise HTTPException(status_code=404, detail='Scan not found')
        return RepositoryScanDocument(**doc)
    update_data['updatedAt'] = datetime.utcnow()
    doc = await collection.find_one_and_update(
        {'_id': oid},
        {'$set': update_data},
        return_document=ReturnDocument.AFTER
    )
    if not doc:
        raise HTTPException(status_code=404, detail='Scan not found')
    return RepositoryScanDocument(**doc)


async def search_repository_scans(query: str, limit: int | None = None) -> List[RepositoryScanDocument]:
    # Treat user input as a literal substring (not a regex) to avoid surprises
    # with characters like '.', '*', '[', etc.
    #
    # Support multi-term search like "Newtonsoft.Json 11.0.2" by requiring each
    # term to match at least one searchable field (AND across terms).
    terms = [t for t in re.split(r"\s+", (query or "").strip()) if t]
    if not terms:
        return []

    def _term_or(term: str) -> dict:
        escaped = re.escape(term)
        regex = {'$regex': escaped, '$options': 'i'}
        return {
            '$or': [
                {'repository_url': regex},
                {'repository_name': regex},
                {'repository_platform': regex},
                {'dependencies.library_path': regex},
                {'dependencies.libraries.library_name': regex},
                {'dependencies.libraries.library_version': regex},
            ]
        }

    mongo_query = _term_or(terms[0]) if len(terms) == 1 else {'$and': [_term_or(t) for t in terms]}
    cursor = collection.find(mongo_query).sort('updatedAt', -1)
    if limit and limit > 0:
        cursor = cursor.limit(limit)
    docs = [RepositoryScanDocument(**doc) async for doc in cursor]

    # If the query matches repo-level metadata, return the full scan (including all dependencies).
    # Otherwise, return a concise payload by filtering to matching dependency files / libraries.
    patterns = [re.compile(re.escape(t), re.IGNORECASE) for t in terms]
    filtered_docs: List[RepositoryScanDocument] = []
    for doc in docs:
        repo_blob = " ".join([(doc.repository_url or ""), (doc.repository_name or ""), (doc.repository_platform or "")])
        repo_level_hit = all(p.search(repo_blob) for p in patterns)
        if repo_level_hit:
            filtered_docs.append(doc)
            continue

        filtered_deps = []
        for dep in doc.dependencies or []:
            path_hit = any(p.search(dep.library_path or '') for p in patterns)

            matched_libs = []
            for lib in dep.libraries or []:
                hay = f"{lib.library_name or ''} {lib.library_version or ''}"
                if all(p.search(hay) for p in patterns):
                    matched_libs.append(lib)

            if path_hit:
                # If the dependency file path matched, keep the whole file block (libraries included)
                filtered_deps.append(dep)
            elif matched_libs:
                # Otherwise keep only the matching libraries
                filtered_deps.append(type(dep)(library_path=dep.library_path, libraries=matched_libs))

        if filtered_deps:
            doc.dependencies = filtered_deps
            filtered_docs.append(doc)

    return filtered_docs
