// Lazy loading of environment variables to ensure dotenv.config() runs first
function getEnvVars() {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_API_URL = process.env.OPENAI_API_URL ?? 'https://api.openai.com/v1/chat/completions';
  const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  const LOCAL_LLM_API_KEY = process.env.LOCAL_LLM_API_KEY;
  const LOCAL_LLM_API_URL = process.env.LOCAL_LLM_API_URL;
  const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL;
  const LOCAL_LLM_AUTH_HEADER = process.env.LOCAL_LLM_AUTH_HEADER;
  const LOCAL_LLM_EXTRA_HEADERS_RAW = process.env.LOCAL_LLM_EXTRA_HEADERS;

  // Debug: Log raw environment variables (first call only)
  if (!getEnvVars._logged) {
    console.log('[mcp] Environment variables check:', {
      LOCAL_LLM_API_KEY: LOCAL_LLM_API_KEY ? `present (${LOCAL_LLM_API_KEY.length} chars)` : 'missing',
      LOCAL_LLM_API_URL: LOCAL_LLM_API_URL || 'missing',
      LOCAL_LLM_AUTH_HEADER: LOCAL_LLM_AUTH_HEADER || 'missing',
      OPENAI_API_KEY: OPENAI_API_KEY ? 'present' : 'missing'
    });
    getEnvVars._logged = true;
  }

  let LOCAL_LLM_EXTRA_HEADERS = { 'X-Request-Source': 'mcp' };

  if (LOCAL_LLM_EXTRA_HEADERS_RAW) {
    try {
      const normalized =
        LOCAL_LLM_EXTRA_HEADERS_RAW.trim().startsWith("'") &&
        LOCAL_LLM_EXTRA_HEADERS_RAW.trim().endsWith("'")
          ? LOCAL_LLM_EXTRA_HEADERS_RAW.trim().slice(1, -1)
          : LOCAL_LLM_EXTRA_HEADERS_RAW;
      const parsed = JSON.parse(normalized);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        LOCAL_LLM_EXTRA_HEADERS = parsed;
      }
    } catch (err) {
      console.warn('[mcp] LOCAL_LLM_EXTRA_HEADERS parse failed; ignoring', err?.message);
    }
  }

  const USING_LOCAL_LLM = Boolean(LOCAL_LLM_API_URL && LOCAL_LLM_API_KEY);
  const CHAT_API_KEY = USING_LOCAL_LLM ? LOCAL_LLM_API_KEY : OPENAI_API_KEY;
  const CHAT_API_URL = USING_LOCAL_LLM ? LOCAL_LLM_API_URL : OPENAI_API_URL;
  // For LOCAL_LLM, use model if provided, otherwise don't send model field (let API use default)
  const CHAT_MODEL = USING_LOCAL_LLM 
    ? (LOCAL_LLM_MODEL?.trim() || null) 
    : OPENAI_MODEL;

  return {
    OPENAI_API_KEY,
    OPENAI_API_URL,
    OPENAI_MODEL,
    LOCAL_LLM_API_KEY,
    LOCAL_LLM_API_URL,
    LOCAL_LLM_MODEL,
    LOCAL_LLM_AUTH_HEADER,
    LOCAL_LLM_EXTRA_HEADERS,
    USING_LOCAL_LLM,
    CHAT_API_KEY,
    CHAT_API_URL,
    CHAT_MODEL
  };
}

const sanitizeHeaderValue = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback;
  const cleaned = String(value).replace(/[^\x20-\x7E]/g, '').trim();
  return cleaned || fallback;
};

export function getActiveLlmInfo() {
  const env = getEnvVars();
  return {
    provider: env.USING_LOCAL_LLM ? 'local' : 'openai',
    apiUrl: env.CHAT_API_URL,
    model: env.CHAT_MODEL ?? null,
    keyPresent: Boolean(env.CHAT_API_KEY),
    localEnabled: env.USING_LOCAL_LLM,
    authHeader: env.USING_LOCAL_LLM ? (env.LOCAL_LLM_AUTH_HEADER?.trim() || 'X-API-Key') : 'Authorization',
    authPrefix: env.USING_LOCAL_LLM ? '' : 'Bearer',
    extraHeaders: env.USING_LOCAL_LLM ? Object.keys(env.LOCAL_LLM_EXTRA_HEADERS) : [],
  };
}

export async function callChat({ messages, temperature = 0, responseFormat = { type: 'json_object' } }) {
  try {
    const env = getEnvVars();
    
    // Debug: Log environment state
    console.log('[mcp] callChat check:', {
      usingLocal: env.USING_LOCAL_LLM,
      hasApiKey: Boolean(env.CHAT_API_KEY),
      hasApiUrl: Boolean(env.CHAT_API_URL),
      apiKeyLength: env.CHAT_API_KEY?.length || 0,
      apiUrl: env.CHAT_API_URL,
      localApiKey: env.LOCAL_LLM_API_KEY ? 'present' : 'missing',
      localApiUrl: env.LOCAL_LLM_API_URL ? 'present' : 'missing'
    });
    
    if (!env.CHAT_API_KEY || !env.CHAT_API_URL) {
      throw new Error(`LLM credentials missing (CHAT_API_KEY: ${Boolean(env.CHAT_API_KEY)}, CHAT_API_URL: ${Boolean(env.CHAT_API_URL)})`);
    }

    const headers = { 'Content-Type': 'application/json' };
    if (env.USING_LOCAL_LLM) {
      const headerName = sanitizeHeaderValue(env.LOCAL_LLM_AUTH_HEADER, 'X-API-Key');
      const cleanApiKey = String(env.CHAT_API_KEY || '').replace(/[\r\n]/g, '').trim();
      Object.assign(headers, env.LOCAL_LLM_EXTRA_HEADERS);
      headers[headerName] = cleanApiKey;
      
      console.log('[mcp] Using LOCAL LLM:', {
        apiUrl: env.CHAT_API_URL,
        headerName,
        apiKeyLength: cleanApiKey.length,
        model: env.CHAT_MODEL
      });
    } else {
      headers.Authorization = `Bearer ${env.CHAT_API_KEY}`;
    }

    const body = {
      temperature,
      response_format: responseFormat,
      messages
    };
    
    // Only include model if it's specified (some APIs don't require it)
    if (env.CHAT_MODEL) {
      body.model = env.CHAT_MODEL;
    }

    const res = await fetch(env.CHAT_API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || `LLM request failed (${res.status})`);
    }
    const json = await res.json();
    const text =
      json.choices?.[0]?.message?.content ||
      json.outputs?.[0]?.text ||
      null;
    if (!text) throw new Error('LLM returned no content');
    return text;
  } catch (err) {
    const env = getEnvVars();
    console.error('[mcp] callChat failed', err);
    console.error('[mcp] callChat params', {
      apiUrl: env.CHAT_API_URL,
      model: env.CHAT_MODEL,
      usingLocal: env.USING_LOCAL_LLM,
      messages: messages
    });

    throw err;
  }
}

export const llmEnv = {
  get USING_LOCAL_LLM() { return getEnvVars().USING_LOCAL_LLM; },
  get CHAT_API_KEY() { return getEnvVars().CHAT_API_KEY; },
  get CHAT_API_URL() { return getEnvVars().CHAT_API_URL; },
  get CHAT_MODEL() { return getEnvVars().CHAT_MODEL; },
};
