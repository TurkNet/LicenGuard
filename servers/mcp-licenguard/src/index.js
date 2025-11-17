import http from 'node:http';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { discoverLibraryInfo, getActiveLlmInfo } from './services/libraryDiscovery.js';
import { analyzeFile } from './services/fileAnalyzer.js';

dotenv.config();
const llmInfo = getActiveLlmInfo();
const logLlmDetails = () => {
  const urlPreview = llmInfo.apiUrl ? llmInfo.apiUrl.replace(/secret|key/gi, '[redacted]') : '(unset)';
  logInfo('[mcp] LLM config', {
    provider: llmInfo.provider,
    model: llmInfo.model,
    apiUrl: urlPreview,
    keyPresent: llmInfo.keyPresent,
    localEnabled: llmInfo.localEnabled
  });
};

const defaultTrue = value => {
  if (value === undefined) return true;
  const normalized = value.trim().toLowerCase();
  return !['false', '0', 'no'].includes(normalized);
};
const logInfo = (...args) => console.log(new Date().toISOString(), ...args);
const logError = (...args) => console.error(new Date().toISOString(), ...args);
const API_BASE = process.env.API_URL ?? 'http://localhost:4000';
const AUTO_IMPORT_ENABLED = defaultTrue(process.env.MCP_AUTO_IMPORT ?? 'false');
const STDIO_ENABLED = defaultTrue(process.env.MCP_STDIO_ENABLED);
const HTTP_ENABLED = defaultTrue(process.env.MCP_HTTP_ENABLED);
const HTTP_PORT = Number(process.env.MCP_HTTP_PORT ?? '3333');
const HTTP_HOST = process.env.MCP_HTTP_HOST ?? '127.0.0.1';
const HTTP_PATH = process.env.MCP_HTTP_PATH ?? '/mcp';

const parseList = (value) =>
  value
    ?.split(',')
    .map(item => item.trim())
    .filter(Boolean);

const ALLOWED_HOSTS = parseList(process.env.MCP_HTTP_ALLOWED_HOSTS);
const ALLOWED_ORIGINS = parseList(process.env.MCP_HTTP_ALLOWED_ORIGINS);

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Request failed (${res.status})`);
  }
  return res.json();
}

async function searchLibrary(query) {
  return request(`/libraries/search/local?q=${encodeURIComponent(query)}`);
}

function computeRisk(m) {
  const summaries = Array.isArray(m.licenseSummary) ? m.licenseSummary : [];
  const textParts = summaries.map(item =>
    typeof item === 'object' && item !== null && 'summary' in item ? item.summary : item
  );
  const emojiParts = summaries
    .map(item => (typeof item === 'object' && item !== null && item.emoji ? item.emoji : null))
    .filter(Boolean);
  const haystack = [m.license ?? '', ...textParts].join(' ').toLowerCase();

  const hasStrong =
    /agpl|gpl|sspl|copyleft/.test(haystack) || emojiParts.some(e => e.includes('🔴') || e.includes('🚫'));
  const hasWeak =
    /lgpl|mpl|cddl/.test(haystack) || emojiParts.some(e => e.includes('🟠') || e.includes('🟡'));
  const hasPermissive =
    /mit|apache|bsd|isc/.test(haystack) || emojiParts.some(e => e.includes('🟢') || e.includes('✅'));

  let level = 'unknown';
  let base = 50; // scale 0-100: lower is safer
  if (hasStrong) {
    level = 'high';
    base = 90;
  } else if (hasWeak) {
    level = 'medium';
    base = 60;
  } else if (hasPermissive) {
    level = 'low';
    base = 10;
  }
  const confidence = typeof m.confidence === 'number' ? m.confidence : 1;
  const score = Math.min(100, Math.max(0, Math.round(base * confidence)));
  return { level, score };
}

async function persistDiscovery(report) {
  try {
    const match = Array.isArray(report.matches) && report.matches.length > 0 ? report.matches[0] : null;
    if (!match) {
    logInfo('[mcp] persist skipped: no matches to save');
      return;
    }
    const normalizeLicenseSummary = (licenseSummary) => {
      if (!licenseSummary) return [];
      if (Array.isArray(licenseSummary)) {
        return licenseSummary
          .map(item => {
            if (typeof item === 'object' && item !== null) {
              return { summary: item.summary ?? '', emoji: item.emoji ?? null };
            }
            return { summary: item, emoji: null };
          })
          .filter(entry => typeof entry.summary === 'string' && entry.summary.length > 0);
      }
      if (Array.isArray(licenseSummary?.summary)) {
        return licenseSummary.summary
          .filter(entry => typeof entry === 'string' && entry.length > 0)
          .map(entry => ({ summary: entry, emoji: null }));
      }
      return [];
    };
    const risk = computeRisk(match);
    const payload = {
      name: match.name ?? report.query?.name ?? 'unknown',
      ecosystem: report.query?.ecosystem ?? 'unknown',
      description: match.description,
      repository_url: match.repository ?? match.officialSite ?? null,
      official_site: match.officialSite ?? null,
      versions: [
        {
          version: match.version ?? report.query?.version ?? 'unknown',
          license_name: match.license ?? null,
          license_url: match.license_url ?? null,
          notes: report.summary ?? null,
          license_summary: normalizeLicenseSummary(match.licenseSummary),
          confidence: match.confidence ?? null,
          evidence: Array.isArray(match.evidence)
            ? match.evidence
            : [
                ...(match.repository ? [`Repo: ${match.repository}`] : []),
                ...(match.officialSite ? [`Official site: ${match.officialSite}`] : []),
              ],
          risk_level: risk.level,
          risk_score: risk.score
        }
      ]
    };
    logInfo('[mcp] persist discovery → /libraries', JSON.stringify(payload));
    await request('/libraries', { method: 'POST', body: JSON.stringify(payload) });
  } catch (error) {
    logError('[mcp] persist discovery failed', error);
  }
}

function createServer() {
  const server = new McpServer({ name: 'licenguard-mcp', version: '0.1.0' });
  logInfo('[mcp] Registering tools...');

  // Local registry so we don't depend on SDK internals for dispatch
  const localToolHandlers = {};

  const listLibrariesHandler = async () => {
    const libraries = await request('/libraries');
    return {
      content: [{ type: 'text', text: JSON.stringify(libraries, null, 2) }],
      structuredContent: libraries
    };
  };
  server.registerTool('list-libraries', { title: 'List libraries', description: 'Fetch all tracked OSS libraries from LicenGuard', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }, listLibrariesHandler);
  localToolHandlers['list-libraries'] = listLibrariesHandler;

  const libraryDetailHandler = async ({ libraryId }) => {
    const library = await request(`/libraries/${libraryId}`);
    return {
      content: [{ type: 'text', text: JSON.stringify(library, null, 2) }],
      structuredContent: library
    };
  };
  server.registerTool('library-detail', { title: 'Get library detail', description: 'Fetch a single library by Mongo id', inputSchema: { type: 'object', required: ['libraryId'], properties: { libraryId: { type: 'string' } }, additionalProperties: false } }, libraryDetailHandler);
  localToolHandlers['library-detail'] = libraryDetailHandler;

  const discoverLibraryInfoHandler = async payload => {
    logInfo('[mcp] discover-library-info payload', JSON.stringify(payload));
    try {
      // Try Mongo first to avoid unnecessary AI calls
      const q = payload.version ? `${payload.name}@${payload.version}` : payload.name;
      try {
        const mongoResult = await searchLibrary(q);
        if (mongoResult?.results && mongoResult.results.length > 0) {
          logInfo('[mcp] discover-library-info served from Mongo', q);
          return {
            content: [{ type: 'text', text: JSON.stringify(mongoResult, null, 2) }],
            structuredContent: mongoResult
          };
        }
      } catch (err) {
        logError('[mcp] discover-library-info Mongo lookup failed', err);
      }

      const report = await discoverLibraryInfo(payload);
      logInfo('[mcp] discover-library-info result', JSON.stringify(report));
      const matchesWithRisk = (Array.isArray(report.matches) ? report.matches : []).map(m => {
        const risk = computeRisk(m);
        return {
          ...m,
          risk_level: risk.level,
          risk_score: risk.score
        };
      });
      let bestMatch = matchesWithRisk.length > 0 ? matchesWithRisk[0] : null;
      if (matchesWithRisk.length > 1) {
        bestMatch = matchesWithRisk.reduce((a, b) => (b.confidence > (a.confidence ?? 0) ? b : a), matchesWithRisk[0]);
      }
      const response = {
        query: report.query,
        matches: matchesWithRisk,
        bestMatch,
        summary: report.summary
      };
      if (AUTO_IMPORT_ENABLED && bestMatch) await persistDiscovery({ ...report, matches: [bestMatch] });
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }], structuredContent: response };
    } catch (error) {
      logError('[mcp] discover-library-info error', error);
      throw error;
    }
  };
  server.registerTool('discover-library-info', { title: 'Discover library metadata', description: 'Use ChatGPT to find repo URLs, versions, and license info for a library.', inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'Library/package name' }, version: { type: 'string', description: 'Version to search for' }, ecosystem: { type: 'string', description: 'npm, maven, nuget, etc.' }, notes: { type: 'string', description: 'Anything else to guide the search' } }, additionalProperties: false } }, discoverLibraryInfoHandler);
  localToolHandlers['discover-library-info'] = discoverLibraryInfoHandler;

  const analyzeFileHandler = async ({ filename, content }) => {
    if (!filename || !content) throw new Error('filename and content are required');
    const report = analyzeFile({ filename, content });
    logInfo('[mcp] analyze-file', JSON.stringify({ filename, manager: report.packageManager, deps: report.dependencies }));
    return {
      content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
      structuredContent: report
    };
  };
  server.registerTool('analyze-file', {
    title: 'Analyze dependency file',
    description: 'Detect package manager and dependencies from uploaded file content',
    inputSchema: {
      type: 'object',
      required: ['filename', 'content'],
      properties: {
        filename: { type: 'string' },
        content: { type: 'string', description: 'Raw file content' }
      },
      additionalProperties: false
    }
  }, analyzeFileHandler);
  localToolHandlers['analyze-file'] = analyzeFileHandler;

  const toolsCallHandler = async ({ name, arguments: args }) => {
    const handler = localToolHandlers[name] ?? localToolHandlers[name.replace(/\//g, '.')] ?? localToolHandlers[name.replace(/\./g, '_')];
    if (!handler) throw new Error(`Tool not found: ${name}`);
    return await handler(args ?? {});
  };
  server.registerTool('tools_call', { title: 'Call a registered tool', description: 'Dispatches to a registered tool by name', inputSchema: { type: 'object', required: ['name', 'arguments'], properties: { name: { type: 'string' }, arguments: { type: 'object' } }, additionalProperties: false } }, toolsCallHandler);
  localToolHandlers['tools_call'] = toolsCallHandler;

  // Debug: list registered tool keys
  try {
    logInfo('[mcp] local tools registered:', Object.keys(localToolHandlers));
  } catch (e) {
    logInfo('[mcp] local tools registered: (unable to introspect)');
  }

  // Debug: list registered tool keys
  try {
    logInfo('[mcp] tools registered:', Object.keys(server.tools || {}));
  } catch (e) {
    logInfo('[mcp] tools registered: (unable to introspect)');
  }

  // Expose local handlers for HTTP debug routes
  try {
    server.localToolHandlers = localToolHandlers;
  } catch (e) {
    // ignore
  }

  return server;
}

async function startStdioServer() {
  if (!STDIO_ENABLED) {
    return;
  }
  const server = createServer();
  const transport = new StdioServerTransport();
  transport.onerror = error => {
    logError('[mcp:stdio] transport error', error);
  };
  transport.onmessage = message => {
    logInfo('[mcp:stdio] message', JSON.stringify(message));
  };
  await server.connect(transport);
  logInfo('[mcp] STDIO transport ready');
}

async function startHttpServer() {
  if (!HTTP_ENABLED) {
    return;
  }
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode: no session required
    enableJsonResponse: true,
    allowedHosts: ALLOWED_HOSTS,
    allowedOrigins: ALLOWED_ORIGINS,
    enableDnsRebindingProtection:
      (ALLOWED_HOSTS && ALLOWED_HOSTS.length > 0) ||
      (ALLOWED_ORIGINS && ALLOWED_ORIGINS.length > 0)
  });
  transport.onerror = error => {
    logError('[mcp:http] transport error', error);
  };

  await server.connect(transport);

  const httpServer = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const preview = rawBody ? rawBody.slice(0, 2000) : '';
      logInfo('[mcp:http] request', req.method, req.url, 'headers=', JSON.stringify(req.headers), 'body=', preview);
      if (!req.url) {
        res.writeHead(404).end('Not Found');
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host ?? `${HTTP_HOST}:${HTTP_PORT}`}`);
      // Debug route for listing registered tools
      if (url.pathname === `${HTTP_PATH}/_debug/tools`) {
        const localKeys = Object.keys(server.localToolHandlers || {});
        const serverKeys = Object.keys(server.tools || {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ local: localKeys, server: serverKeys }, null, 2));
        return;
      }

      if (url.pathname !== HTTP_PATH) {
        res.writeHead(404).end('Not Found');
        return;
      }

      let parsedBody;
      if (rawBody) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = undefined;
          logInfo('[mcp:http] invalid JSON body:', rawBody.slice(0, 200));
        }
      }

      // If client sends non-standard tools invocation (e.g. method 'tools_call' or variants),
      // handle it here so older/alternate clients work.
      if (parsedBody && typeof parsedBody.method === 'string') {
        const method = parsedBody.method;
        const toolsCallVariants = new Set(['tools_call', 'tools.call', 'tools/call']);
        if (toolsCallVariants.has(method) || (method === 'tools' && parsedBody.params?.name)) {
          try {
            const params = parsedBody.params ?? {};
            const toolName = params.name ?? params.tool ?? (params.arguments && params.arguments.name) ?? null;
            const args = params.arguments ?? params.args ?? params.arguments ?? {};
            if (!toolName) {
              throw new Error('Missing tool name in params');
            }
            // Try to find registered tool handler (allow exact, dot/underscore variants)
            const findToolEntry = (n) => {
              // Try local handlers first (attached to server)
              if (server.localToolHandlers?.[n]) return { handler: server.localToolHandlers[n] };
              // Direct server registry
              if (server.tools?.[n]) return server.tools[n];
              // Try common variants
              const dot = n.replace(/\//g, '.');
              if (server.localToolHandlers?.[dot]) return { handler: server.localToolHandlers[dot] };
              if (server.tools?.[dot]) return server.tools[dot];
              const underscore = n.replace(/\./g, '_').replace(/\//g, '_');
              if (server.localToolHandlers?.[underscore]) return { handler: server.localToolHandlers[underscore] };
              if (server.tools?.[underscore]) return server.tools[underscore];
              // Strip npm scope and version suffix (e.g. '@scope/name@1.2.3')
              const noVersion = n.replace(/@\d.*$/, '');
              const noScope = noVersion.replace(/^@[^/]+\//, '');
              if (noScope !== n) {
                if (server.localToolHandlers?.[noScope]) return { handler: server.localToolHandlers[noScope] };
                if (server.tools?.[noScope]) return server.tools[noScope];
              }
              return null;
            };
            const toolEntry = findToolEntry(toolName);
            if (!toolEntry) {
              throw new Error(`Tool not found: ${toolName}`);
            }
            const result = await toolEntry.handler(args);
            const rpcRes = { jsonrpc: '2.0', id: parsedBody.id ?? null, result };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(rpcRes));
            return;
          } catch (err) {
            logError('[mcp:http] tools_call dispatch error', err);
            const rpcErr = { jsonrpc: '2.0', id: parsedBody.id ?? null, error: { code: -32601, message: err.message } };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(rpcErr));
            return;
          }
        }
      }
      await transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      logError('[mcp:http] request error', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Internal MCP HTTP error' },
            id: null
          })
        );
      } else {
        res.end();
      }
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
      logInfo(`[mcp] HTTP transport listening on http://${HTTP_HOST}:${HTTP_PORT}${HTTP_PATH}`);
      resolve();
    });
  });
}

async function main() {
  if (!STDIO_ENABLED && !HTTP_ENABLED) {
    throw new Error('At least one MCP transport must be enabled');
  }

  logLlmDetails();
  await Promise.all([startStdioServer(), startHttpServer()]);
}

main().catch((error) => {
  logError('[mcp] fatal', error);
  process.exit(1);
});
