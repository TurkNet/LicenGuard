import fetch from 'node-fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = process.env.OPENAI_API_URL ?? 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

const LOCAL_LLM_API_KEY = process.env.LOCAL_LLM_API_KEY;
const LOCAL_LLM_API_URL = process.env.LOCAL_LLM_API_URL;
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL;
const LOCAL_LLM_AUTH_HEADER = process.env.LOCAL_LLM_AUTH_HEADER;
const LOCAL_LLM_AUTH_PREFIX = process.env.LOCAL_LLM_AUTH_PREFIX;
const LOCAL_LLM_EXTRA_HEADERS_RAW = process.env.LOCAL_LLM_EXTRA_HEADERS;

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
const CHAT_MODEL = USING_LOCAL_LLM ? LOCAL_LLM_MODEL : OPENAI_MODEL;

export function getActiveLlmInfo() {
  return {
    provider: USING_LOCAL_LLM ? 'local' : 'openai',
    apiUrl: CHAT_API_URL,
    model: CHAT_MODEL ?? null,
    keyPresent: Boolean(CHAT_API_KEY),
    localEnabled: USING_LOCAL_LLM,
    authHeader: USING_LOCAL_LLM ? LOCAL_LLM_AUTH_HEADER?.trim() || 'X-API-Key' : 'Authorization',
    authPrefix:
      USING_LOCAL_LLM && LOCAL_LLM_AUTH_PREFIX !== undefined
        ? LOCAL_LLM_AUTH_PREFIX
        : USING_LOCAL_LLM
          ? ''
          : 'Bearer',
    extraHeaders: USING_LOCAL_LLM ? Object.keys(LOCAL_LLM_EXTRA_HEADERS) : [],
  };
}

export async function callChat({ messages, temperature = 0, responseFormat = { type: 'json_object' } }) {
  try {
    if (!CHAT_API_KEY || !CHAT_API_URL) {
      throw new Error('LLM credentials missing (CHAT_API_KEY or CHAT_API_URL)');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (USING_LOCAL_LLM) {
      const headerName = LOCAL_LLM_AUTH_HEADER?.trim() || 'X-API-Key';
      const prefix = LOCAL_LLM_AUTH_PREFIX ?? '';
      headers[headerName] = prefix.trim() ? `${prefix.trim()} ${CHAT_API_KEY}` : CHAT_API_KEY;
      Object.assign(headers, LOCAL_LLM_EXTRA_HEADERS);
    } else {
      headers.Authorization = `Bearer ${CHAT_API_KEY}`;
    }

    const body = {
      model: CHAT_MODEL,
      temperature,
      response_format: responseFormat,
      messages
    };

    const res = await fetch(CHAT_API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
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
    console.error('[mcp] callChat failed', err);
    console.error('[mcp] callChat params', {
      apiUrl: CHAT_API_URL,
      model: CHAT_MODEL,
      usingLocal: USING_LOCAL_LLM,
      messages: messages
    });

    throw err;
  }
}

export const llmEnv = {
  USING_LOCAL_LLM,
  CHAT_API_KEY,
  CHAT_API_URL,
  CHAT_MODEL,
};
