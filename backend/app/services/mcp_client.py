from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx

from ..config import get_settings

JSONRPC_VERSION = '2.0'
LATEST_PROTOCOL_VERSION = '2025-06-18'


class MCPClientError(RuntimeError):
    """Raised when the MCP server cannot be reached or returns an error."""


class MCPHttpClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self._session_id: Optional[str] = None
        self._protocol_version: Optional[str] = None
        self._initialized = False
        timeout = httpx.Timeout(30.0, connect=5.0)
        self._client = httpx.AsyncClient(timeout=timeout)
        self._lock = asyncio.Lock()

    async def ensure_initialized(self) -> None:
        if self._initialized:
            return
        async with self._lock:
            if self._initialized:
                return
            request_id = str(uuid4())
            params = {
                'protocolVersion': LATEST_PROTOCOL_VERSION,
                'capabilities': {},
                'clientInfo': {'name': 'licenguard-backend', 'version': '0.1.0'}
            }
            result = await self._send_request('initialize', params, request_id)
            if not isinstance(result, dict):
                raise MCPClientError('Invalid initialize response from MCP server')
            protocol = result.get('protocolVersion')
            if protocol is None:
                raise MCPClientError('MCP server did not provide protocolVersion')
            self._protocol_version = protocol
            self._initialized = True
            await self._send_notification('notifications/initialized')

    async def discover_library(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        await self.ensure_initialized()
        try:
            result = await self._send_request(
                'tools_call',
                {'name': 'discover-library-info', 'arguments': payload},
                str(uuid4())
            )
        except MCPClientError as error:
            # If the server reports it is not initialized, reset state and retry once
            if 'Server not initialized' in str(error):
                self._initialized = False
                self._session_id = None
                self._protocol_version = None
                await self.ensure_initialized()
                result = await self._send_request(
                    'tools_call',
                    {'name': 'discover-library-info', 'arguments': payload},
                    str(uuid4())
                )
            else:
                raise
        if not isinstance(result, dict):
            return None
        structured = result.get('structuredContent') or result.get('data') or result
        if structured is None:
            return None
        if isinstance(structured, list):
            return structured[0] if structured else None
        if isinstance(structured, dict):
            return structured
        raise MCPClientError('Unexpected structured content from MCP server')

    async def analyze_file(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        await self.ensure_initialized()
        try:
            result = await self._send_request(
                'tools_call',
                {'name': 'analyze-file', 'arguments': payload},
                str(uuid4())
            )
        except MCPClientError as error:
            if 'Server not initialized' in str(error):
                self._initialized = False
                self._session_id = None
                self._protocol_version = None
                await self.ensure_initialized()
                result = await self._send_request(
                    'tools_call',
                    {'name': 'analyze-file', 'arguments': payload},
                    str(uuid4())
                )
            else:
                raise
        if not isinstance(result, dict):
            return None
        structured = result.get('structuredContent')
        if isinstance(structured, dict):
            return structured
        raise MCPClientError('Unexpected structured content from MCP server')

    async def _send_notification(self, method: str) -> None:
        message: Dict[str, Any] = {'jsonrpc': JSONRPC_VERSION, 'method': method}
        await self._post(message, expect_response=False)

    async def _send_request(self, method: str, params: Dict[str, Any], request_id: str) -> Any:
        message = {'jsonrpc': JSONRPC_VERSION, 'id': request_id, 'method': method, 'params': params}
        responses = await self._post(message)
        if not responses:
            raise MCPClientError('No response from MCP server')
        target = next((msg for msg in responses if msg.get('id') == request_id), None)
        if target is None:
            raise MCPClientError('Missing JSON-RPC response from MCP server')
        if 'error' in target:
            error = target['error']
            raise MCPClientError(error.get('message', 'MCP server returned error'))
        return target.get('result')

    async def _post(self, message: Dict[str, Any], expect_response: bool = True) -> Optional[List[Dict[str, Any]]]:
        headers = {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json'
        }
        if self._session_id:
            headers['Mcp-Session-Id'] = self._session_id
        if self._protocol_version:
            headers['Mcp-Protocol-Version'] = self._protocol_version
        try:
            response = await self._client.post(self.base_url, headers=headers, json=message)
        except httpx.HTTPError as exc:
            raise MCPClientError(f'Failed to contact MCP server: {exc}') from exc
        log_info = f'{datetime.utcnow().isoformat()} [mcp-client] POST {self.base_url} status {response.status_code}'
        print(log_info)
        if response.is_error:
            raise MCPClientError(f'MCP server responded with {response.status_code}: {response.text}')
        if not expect_response or response.status_code == 202:
            return None
        session_id = response.headers.get('mcp-session-id')
        if session_id:
            self._session_id = session_id
        try:
            payload = response.json()
        except ValueError as exc:
            raise MCPClientError('MCP server returned invalid JSON') from exc
        if isinstance(payload, list):
            return payload
        return [payload]


def get_mcp_http_client() -> Optional[MCPHttpClient]:
    settings = get_settings()
    if not settings.mcp_http_url:
        return None
    client: Optional[MCPHttpClient] = getattr(get_mcp_http_client, '_client', None)
    if client is None:
        client = MCPHttpClient(settings.mcp_http_url)
        setattr(get_mcp_http_client, '_client', client)
    return client
