import fetch from "node-fetch";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL =
  process.env.OPENAI_API_URL ?? "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const LOCAL_LLM_API_KEY = process.env.LOCAL_LLM_API_KEY;
const LOCAL_LLM_API_URL = process.env.LOCAL_LLM_API_URL;
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL; // optional for local
const LOCAL_LLM_AUTH_HEADER = process.env.LOCAL_LLM_AUTH_HEADER; // default X-API-Key
const LOCAL_LLM_AUTH_PREFIX = process.env.LOCAL_LLM_AUTH_PREFIX; // e.g. Bearer / Token / (empty for raw key)
const LOCAL_LLM_EXTRA_HEADERS_RAW = process.env.LOCAL_LLM_EXTRA_HEADERS;

let LOCAL_LLM_EXTRA_HEADERS = { "X-Request-Source": "post_text_script" };
if (LOCAL_LLM_EXTRA_HEADERS_RAW) {
  try {
    const normalized =
      LOCAL_LLM_EXTRA_HEADERS_RAW.trim().startsWith("'") &&
      LOCAL_LLM_EXTRA_HEADERS_RAW.trim().endsWith("'")
        ? LOCAL_LLM_EXTRA_HEADERS_RAW.trim().slice(1, -1)
        : LOCAL_LLM_EXTRA_HEADERS_RAW;
    const parsed = JSON.parse(normalized);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      LOCAL_LLM_EXTRA_HEADERS = parsed;
    }
  } catch (err) {
    console.warn("[mcp] LOCAL_LLM_EXTRA_HEADERS parse failed; ignoring", err?.message);
  }
}

const RESPONSE_LANGUAGE = process.env.RESPONSE_LANGUAGE ?? "English";
const USING_LOCAL_LLM = Boolean(LOCAL_LLM_API_URL && LOCAL_LLM_API_KEY);
const CHAT_API_KEY = USING_LOCAL_LLM ? LOCAL_LLM_API_KEY : OPENAI_API_KEY;
const CHAT_API_URL = USING_LOCAL_LLM ? LOCAL_LLM_API_URL : OPENAI_API_URL;
const CHAT_MODEL = USING_LOCAL_LLM ? LOCAL_LLM_MODEL : OPENAI_MODEL;

export function getActiveLlmInfo() {
  return {
    provider: USING_LOCAL_LLM ? "local" : "openai",
    apiUrl: CHAT_API_URL,
    model: CHAT_MODEL ?? null,
    keyPresent: Boolean(CHAT_API_KEY),
    localEnabled: USING_LOCAL_LLM,
    authHeader: USING_LOCAL_LLM
      ? LOCAL_LLM_AUTH_HEADER?.trim() || "X-API-Key"
      : "Authorization",
    authPrefix:
      USING_LOCAL_LLM && LOCAL_LLM_AUTH_PREFIX !== undefined
        ? LOCAL_LLM_AUTH_PREFIX
        : USING_LOCAL_LLM
          ? ""
          : "Bearer",
    extraHeaders: USING_LOCAL_LLM ? Object.keys(LOCAL_LLM_EXTRA_HEADERS) : [],
  };
}

const SYSTEM_PROMPT = `You are an OSS discovery assistant. Given a library name, optional version, ecosystem, and notes,
you search the public internet (docs, GitHub, package registries) to find the most likely matching projects.

When searching npm packages, consult authoritative registry data (e.g., npm view <pkg> versions, license, repository) to populate version/license details accurately. For Python packages, consult tooling such as \`pip show <pkg>\` / \`pip3 show <pkg>\` (and language-appropriate equivalents for other ecosystems) to retrieve version, license, and repository details when possible.

Return JSON with the following structure:
{
  "query": {
    "name": "...",
    "version": "...",
    "ecosystem": "...", // npm, pypi, maven, nuget, etc.
    "notes": "..."
  },
  "matches": [
    {
      "name": "string",
      "officialSite": "https://...",
      "repository": "https://github.com/...",
      "version": "string",
      "license": "MIT / Apache-2.0 / ...",
      "license_url": "https://.../LICENSE",
      "licenseSummary": [
        { "summary": "short bullet 1", "emoji": "🔴/🟠/🟡/🟢/⚠️" },
        { "summary": "short bullet 2", "emoji": "🔴/🟠/🟡/🟢/⚠️" }
      ],
      "confidence": 0-1,
      "description": "short summary",
      "evidence": ["link or explanation"]
    }
  ],
  "summary": "short text summary of what you found and any ambiguities"
}

If the user provides ecosystem/version as unknown or omits them, infer them where possible:
- Set query.ecosystem to the detected package manager (npm/pypi/maven/nuget/etc.) if you can infer from sources; avoid "unknown" when evidence exists.
- Set query.version to the best version you report (e.g., the latest stable) instead of "unknown".
- Always set \`ecosystem\` (on query and on every match) using this mapping:
  - npm → "JavaScript / Node.js"
  - pypi → "Python"
  - maven → "Java / JVM"
  - nuget → ".NET"
  - rubygems → "Ruby"
  - crates → "Rust"
  - packagist → "PHP"
  - cocoapods → "iOS / Swift / Obj-C"
  - gradle → "Java / Kotlin"
  - go → "Go"

When providing licenseSummary, favor concise bullet points like:
[
  "Ticari kullanıma izin verir",
  "Değiştirilmiş versiyonları dağıtabilirsiniz",
  "Özel kullanım için serbest",
  "Lisans ve telif hakkı bildirimi gereklidir"
]

License emoji guidance:
- Strong copyleft (AGPL/GPL/SSPL): use "🔴" and include obligations (kaynak kodunu yayınlama, ağ üzerinden paylaşım).
- Weak/limited copyleft (LGPL/MPL/CDDL): use "🟠" or "🟡" and note linking/module requirements.
- Permissive (MIT/Apache/BSD/ISC): use "🟢" and note notice/attribution requirements.
- Unknown/custom: use "⚠️" and advise manual review.

If the user does not specify a version, choose the latest stable version you can find for that ecosystem.

Prefer authoritative sources (GitHub, GitLab, package registry pages). If nothing relevant is found, return matches: []
and explain in summary. All responses (description, summary, licenseSummary bullets) should be in ${RESPONSE_LANGUAGE}.

Open-source licensing and copyleft guidance:
- Explicitly mention obligations in AGPL/GPL/SSPL-style licenses (e.g., "Kaynak kodunu yayınlamanız gerekir", "Ağ üzerinden sunulan hizmetlerde kaynak kodunu paylaşma yükümlülüğü vardır").
- Add a warning bullet to licenseSummary for strong copyleft licenses to make compliance risk clear.
- Include a short note in \`summary\` when the license is copyleft, e.g., compliance requirements or when to avoid in proprietary products.
`;

export async function discoverLibraryInfo({ name, version, ecosystem, notes }) {
  if (!CHAT_API_KEY) {
    throw new Error(
      "Missing API key: configure LOCAL_LLM_API_KEY/LOCAL_LLM_API_URL for local usage or OPENAI_API_KEY for OpenAI."
    );
  }
  if (!CHAT_API_URL) {
    throw new Error(
      "Missing chat API URL: configure LOCAL_LLM_API_URL for local usage or OPENAI_API_URL for OpenAI."
    );
  }

  const body = {
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Library: ${name}
        Version: ${version ?? "unknown"}
        Ecosystem: ${ecosystem ?? "unknown"}
        Notes: ${notes ?? "n/a"}

        Return JSON as specified.`,
      },
    ],
  };

  if (CHAT_MODEL) {
    body.model = CHAT_MODEL;
  }

  const headers = { "Content-Type": "application/json" };

  if (USING_LOCAL_LLM) {
    const headerName = LOCAL_LLM_AUTH_HEADER?.trim() || "X-API-Key";
    const prefix = LOCAL_LLM_AUTH_PREFIX ?? "";
    headers[headerName] =
      prefix.trim()
        ? `${prefix.trim()} ${CHAT_API_KEY}`
        : CHAT_API_KEY;
  } else {
    headers.Authorization = `Bearer ${CHAT_API_KEY}`;
  }

  if (USING_LOCAL_LLM && LOCAL_LLM_EXTRA_HEADERS && typeof LOCAL_LLM_EXTRA_HEADERS === "object") {
    Object.assign(headers, LOCAL_LLM_EXTRA_HEADERS);
  }

  const redactedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      if (typeof value === "string" && CHAT_API_KEY && value.includes(CHAT_API_KEY)) {
        return [key, value.replace(CHAT_API_KEY, "[redacted]")];
      }
      return [key, value];
    })
  );

  const response = await fetch(CHAT_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    console.error(
      "[mcp] LLM request failed",
      response.status,
      response.statusText,
      message?.slice?.(0, 200),
      {
        url: CHAT_API_URL,
        model: CHAT_MODEL ?? "unspecified",
        provider: USING_LOCAL_LLM ? "local" : "openai",
        headers: redactedHeaders,
        bodyPreview: JSON.stringify(body)?.slice?.(0, 500),
      }
    );
    throw new Error(
      message || `LLM request failed (${response.status} ${response.statusText})`
    );
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM response missing content");
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Unable to parse LLM JSON: ${error.message}`);
  }
}
