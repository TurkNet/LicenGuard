import fetch from "node-fetch";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL =
  process.env.OPENAI_API_URL ?? "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const RESPONSE_LANGUAGE = process.env.RESPONSE_LANGUAGE ?? "English";

const SYSTEM_PROMPT = `You are an OSS discovery assistant. Given a library name, optional version, ecosystem, and notes,
you search the public internet (docs, GitHub, package registries) to find the most likely matching projects.

When searching npm packages, consult authoritative registry data (e.g., npm view <pkg> versions, license, repository) to populate version/license details accurately. For Python packages, consult tooling such as \`pip show <pkg>\` / \`pip3 show <pkg>\` (and language-appropriate equivalents for other ecosystems) to retrieve version, license, and repository details when possible.

Return JSON with the following structure:
{
  "query": {
    "name": "...",
    "version": "...",
    "ecosystem": "...",
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
      "licenseSummary": ["short bullet 1", "short bullet 2"],
      "confidence": 0-1,
      "description": "short summary",
      "evidence": ["link or explanation"]
    }
  ],
  "summary": "short text summary of what you found and any ambiguities"
}

When providing licenseSummary, favor concise bullet points like:
[
  "Ticari kullanıma izin verir",
  "Değiştirilmiş versiyonları dağıtabilirsiniz",
  "Özel kullanım için serbest",
  "Lisans ve telif hakkı bildirimi gereklidir"
]

If the user does not specify a version, choose the latest stable version you can find for that ecosystem.

Prefer authoritative sources (GitHub, GitLab, package registry pages). If nothing relevant is found, return matches: []
and explain in summary. All responses (description, summary, licenseSummary bullets) should be in ${RESPONSE_LANGUAGE}.`;

export async function discoverLibraryInfo({ name, version, ecosystem, notes }) {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is required to run discovery. Set it in the MCP server environment."
    );
  }

  const body = {
    model: OPENAI_MODEL,
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

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    console.error(
      "[mcp] OpenAI request failed",
      response.status,
      response.statusText,
      message?.slice?.(0, 200)
    );
    throw new Error(
      message || `OpenAI request failed (${response.status} ${response.statusText})`
    );
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI response missing content");
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Unable to parse OpenAI JSON: ${error.message}`);
  }
}
