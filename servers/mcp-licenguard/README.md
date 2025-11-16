# LicenGuard MCP server

Expose LicenGuard data to MCP-compatible agents. Requires the Python API running locally.

```bash
cd servers/mcp-licenguard
npm install
API_URL=http://localhost:4000 OPENAI_API_KEY=sk-... npm run dev
```

Tools:
- `list-libraries` – returns the entire library catalog.
- `library-detail` – fetches a single library by id.
- `discover-library-info` – uses ChatGPT (OpenAI) to find GitHub/homepage URLs, versions, and license info for a library. Configure `OPENAI_API_KEY`, optionally `OPENAI_MODEL` / `OPENAI_API_URL`.

## Transports

The server now speaks both STDIO and the Streamable HTTP transport:

- STDIO remains enabled by default for IDE integrations.
- HTTP is also enabled by default and listens on `http://127.0.0.1:3333/mcp`. Point any MCP HTTP client (Claude Desktop, VS Code MCP inspector, etc.) at that URL.

Environment toggles:

| Variable | Default | Description |
| --- | --- | --- |
| `MCP_STDIO_ENABLED` | `true` | Disable (`false`) to skip STDIO startup. |
| `MCP_HTTP_ENABLED` | `true` | Disable (`false`) to skip HTTP transport. |
| `MCP_HTTP_PORT` | `3333` | Listening port for HTTP transport. |
| `MCP_HTTP_HOST` | `127.0.0.1` | Listening address for HTTP transport. |
| `MCP_HTTP_PATH` | `/mcp` | Path guarded by the MCP handler. |
| `MCP_HTTP_ALLOWED_HOSTS` | _unset_ | Optional comma-separated hosts for DNS-rebinding protection. |
| `MCP_HTTP_ALLOWED_ORIGINS` | _unset_ | Optional comma-separated origins for DNS-rebinding protection. |
