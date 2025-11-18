import { callChat, llmEnv } from './llmClient.js';

export const RISK_SCORING_SYSTEM_PROMPT = `You are an “Open Source License Risk Analyst.”

Goal:
- Based on the provided open-source library record (LicenGuard JSON), produce a RISK SCORE between 0–100 and briefly explain the reasoning.

Input (summary):
- name, ecosystem, description, repository_url, officialSite
- versions[].version
- versions[].license_name, license_url, license_summary[]
- versions[].evidence[], confidence
- versions[].risk_score, versions[].risk_level (if present)
- The following derived fields may also be included in the future (consider if present):
- license_family (permissive / weak_copyleft / strong_copyleft / network_copyleft / proprietary_like)
- copyleft_strength (none / weak / strong / network)
- has_patent_grant, has_patent_retaliation_clause
- attribution_required, source_modification_disclosure_required
- is_custom_license, multi_license


Risk model:
- Produce a total risk_score between 0–100:
  - license_risk_score: 0–40
    - strong_copyleft / network_copyleft (GPL, AGPL, SSPL etc.) → higher risk
    - custom or unclear licenses → higher risk
    - permissive (MIT, BSD, Apache-2.0 etc.) → lower risk
    - SaaS/Network copyleft clauses (AGPL, SSPL) increase risk especially for SaaS/online services.

Risk levels:
- 0–20   → "low"
- 21–40  → "medium"
- 41–70  → "high"
- 71–100 → "critical"

Output:
Return JSON with the following structure:
{
  "name": "...",
  "version": "...",
  "risk_score": an integer between 0–100,
  "risk_level": "low" | "medium" | "high" | "critical",
  "license_risk_score": integer between 0–40,
  "security_risk_score": integer between 0–30,
  "maintenance_risk_score": integer between 0–20,
  "usage_context_risk_score": integer between 0–10,
  "key_factors": [
    "Key reasons related to license type and copyleft strength",
    "Key reasons related to maintenance and project activity",
    "Key security-related factors (if any)",
    "Key usage-context or company-policy factors (if any)"
  ],
  "recommended_actions": [
    "Write the recommended actions for this library concisely and clearly"
  ],
  "confidence": a decimal value between 0 and 1 representing your confidence level
}

Rules:
- Only use the information provided in the JSON.
- Do NOT assume or hallucinate missing fields; treat absent fields as irrelevant.
- Keep explanations concise and clear.
`;


/**
 * Paketi alır, LLM ile risk skorlamasını hesaplar ve JSON döner.
 */
export async function scoreLibraryRisk(pkg) {
    const userContent = `Library: ${pkg.name}
        Version: ${pkg.versions[0].version ?? "unknown"}
        Ecosystem: ${pkg.ecosystem ?? "unknown"}
        License Name: ${pkg.versions[0].license_name ?? "unknown"}
        License URL: ${pkg.versions[0].license_url ?? "unknown"}
        License Summary: ${Array.isArray(pkg.versions[0].license_summary) ? pkg.versions[0].license_summary.map(item => typeof item === 'object' && item !== null && 'summary' in item ? item.summary : item).join("; ") : "unknown"}

        Return JSON as specified.`;

  try {
    const content = await callChat({
      temperature: 0.1,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: "system", content: RISK_SCORING_SYSTEM_PROMPT },
        { role: "user", content: userContent }
      ]
    });
    return JSON.parse(content);
  } catch (error) {
    console.error('[mcp] scoreLibraryRisk failed', {
      error: error?.message,
      apiUrl: llmEnv.CHAT_API_URL,
      model: llmEnv.CHAT_MODEL,
      usingLocal: llmEnv.USING_LOCAL_LLM,
      messages: [
        { role: "system", content: RISK_SCORING_SYSTEM_PROMPT },
        { role: "user", content: userContent }
      ]
      });
    throw error;
  }
}
