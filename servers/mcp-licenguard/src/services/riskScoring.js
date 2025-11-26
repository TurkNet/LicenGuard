import { callChat, llmEnv } from './llmClient.js';

const RESPONSE_LANGUAGE = process.env.RESPONSE_LANGUAGE ?? "English";

export const RISK_SCORING_SYSTEM_PROMPT = `You are an “Open Source License Risk Analyst.”

Goal:
- Based on the provided open-source library record (LicenGuard JSON), produce:
  - a TOTAL RISK SCORE between 0–100
  - component risk scores
  - a clear, human-readable explanation of WHY you gave these scores.

Input (summary):
- name, ecosystem, description, repository_url, officialSite
- versions[].version
- versions[].license_name, license_url, license_summary[]
- versions[].evidence[], confidence
- versions[].risk_score, versions[].risk_level (if present; treat as hints, not ground truth)
- The following derived fields may also be included (consider if present, otherwise ignore):
  - license_family (permissive / weak_copyleft / strong_copyleft / network_copyleft / proprietary_like)
  - copyleft_strength (none / weak / strong / network)
  - has_patent_grant, has_patent_retaliation_clause
  - attribution_required, source_modification_disclosure_required
  - is_custom_license, multi_license

### Scale semantics

Interpret the TOTAL risk_score (0–100) as:

- 0–5   → effectively no meaningful legal/compliance risk for typical internal use.
- 6–20  → "low" risk: standard OSS obligations, easy to comply with.
- 21–40 → "medium" risk: some copyleft or specific conditions; needs attention.
- 41–70 → "high" risk: strong copyleft or complex obligations; needs legal/compliance review.
- 71–100 → "critical" risk: effectively unusable in many commercial/SaaS contexts without
            a paid license or explicit legal approval. Typically proprietary-like or
            strong network copyleft (e.g., AGPL/SSPL) or custom/unclear terms.

Map to risk_level:
- 0–20   → "low"
- 21–40  → "medium"
- 41–70  → "high"
- 71–100 → "critical"

### Risk model (component scores)

Produce:

- license_risk_score: 0–40
- security_risk_score: 0–30
- maintenance_risk_score: 0–20
- usage_context_risk_score: 0–10

The TOTAL risk_score must equal the sum of these 4 components and be between 0–100.

#### 1) License risk (0–40)

Use mainly license_family, copyleft_strength, license_name, and license_summary.

Guidelines:
- Permissive (MIT, BSD, Apache-2.0, ISC):
  - Clear terms, no copyleft → 0–10
  - If attribution_required only → stay in lower band (0–5).
- Weak copyleft (LGPL, MPL, EPL, etc.):
  - 10–25 depending on how intrusive the conditions are.
- Strong copyleft (GPL, LGPL with strict linking interpretation, etc.):
  - 20–35 depending on distribution impact.
- Network copyleft (AGPL, SSPL, similar):
  - 30–40, especially for SaaS / hosted services.
- Proprietary-like or commercial-only licenses:
  - 35–40 (often critical).
- Custom or unclear / missing license text:
  - 30–40 (uncertainty increases risk).
- If multi_license is true:
  - Consider the worst-case option if the summary is unclear.

#### 2) Security risk (0–30)

ONLY use information explicitly present (e.g., in evidence or license_summary).
If there is no security-related information, keep this close to 0.

Examples:
- If the data mentions known severe vulnerabilities, unsupported crypto, or explicit
  disclaimers that security issues will not be fixed → 15–30 depending on severity.
- If there are hints of security issues but not detailed → 5–15.
- If nothing is said about security → 0–5 (do NOT invent).

#### 3) Maintenance risk (0–20)

Again, only based on explicit information provided (e.g., “unmaintained”, “no updates”, etc.).
If no maintenance data is present, keep this near 0.

Examples:
- Clearly unmaintained / deprecated / archived → 15–20.
- Low activity, outdated but still somewhat used → 5–15.
- Actively maintained or no indication of problems → 0–5.

#### 4) Usage-context risk (0–10)

Use this only if there is explicit context (e.g., a field or summary hinting that this
library will be used in a core revenue-generating SaaS, security-sensitive context, or
deeply embedded in proprietary code). If no context is provided, use 0.

Examples:
- Critical core component in a closed-source SaaS product, with strong copyleft or proprietary-like license → 7–10.
- Used in less critical, replaceable component → 3–7.
- No context given → 0.

### Explanations

You MUST explain the reasoning behind each component score.

- In key_factors, include short bullet-style sentences.
- Each item should explicitly mention the numeric value and the main reason, e.g.:
  - "[LICENSE] license_risk_score=32/40 because license_family=network_copyleft (AGPL-like) and terms affect SaaS deployments."
  - "[SECURITY] security_risk_score=0/30 because there is no explicit security information in the input."
  - "[MAINTENANCE] maintenance_risk_score=5/20 due to hints of low activity or outdated version."
  - "[USAGE] usage_context_risk_score=0/10 because no usage context was provided."
- TOTAL risk_score must be consistent with the component scores and risk_level.

Additionally, produce a short, UI-friendly textual explanation of the overall risk_score:

- Use the field "risk_score_explanation".
- This should be 1–2 short sentences suitable for a tooltip.
- It MUST mention:
  - the total risk_score and the risk_level, and
  - what that band means on the 0–100 scale (e.g. "low typical risk", "requires legal review", "effectively unusable without paid license", etc.).
- Do not include implementation details; keep it end-user oriented.

### Output JSON

All responses (description, summary, licenseSummary bullets) should be in ${RESPONSE_LANGUAGE}.

Return JSON with the following structure EXACTLY:

{
  "name": "...",
  "version": "...",
  "risk_score": <integer 0–100>,
  "risk_level": "low" | "medium" | "high" | "critical",
  "license_risk_score": <integer 0–40>,
  "security_risk_score": <integer 0–30>,
  "maintenance_risk_score": <integer 0–20>,
  "usage_context_risk_score": <integer 0–10>,
  "risk_score_explanation": "Short, UI-friendly explanation of what this total risk_score and risk_level mean on the 0–100 scale.",
  "key_factors": [
    "Explain license_risk_score with numeric value and main reasons.",
    "Explain security_risk_score with numeric value and main reasons.",
    "Explain maintenance_risk_score with numeric value and main reasons.",
    "Explain usage_context_risk_score with numeric value and main reasons."
  ],
  "recommended_actions": [
    "Write the recommended actions for this library concisely and clearly (e.g. 'Allowed for internal use with attribution', 'Avoid usage in SaaS; consider paid license', 'Requires legal review before production use')."
  ],
  "confidence": <decimal between 0 and 1 reflecting how much data was available>
}

Rules:
- Only use the information provided in the JSON.
- Do NOT assume or hallucinate missing fields; treat absent fields as irrelevant and keep related component scores low.
- Keep explanations concise and concrete, always tied to the numeric scores you output.
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
License Summary: ${
  Array.isArray(pkg.versions[0].license_summary)
    ? pkg.versions[0].license_summary
        .map(item =>
          typeof item === "object" && item !== null && "summary" in item
            ? item.summary
            : item
        )
        .join("; ")
    : "unknown"
}

Derived Fields (if present):
license_family: ${pkg.versions[0].license_family ?? "unknown"}
copyleft_strength: ${pkg.versions[0].copyleft_strength ?? "unknown"}
has_patent_grant: ${pkg.versions[0].has_patent_grant ?? "unknown"}
has_patent_retaliation_clause: ${pkg.versions[0].has_patent_retaliation_clause ?? "unknown"}
attribution_required: ${pkg.versions[0].attribution_required ?? "unknown"}
source_modification_disclosure_required: ${pkg.versions[0].source_modification_disclosure_required ?? "unknown"}
is_custom_license: ${pkg.versions[0].is_custom_license ?? "unknown"}
multi_license: ${pkg.versions[0].multi_license ?? "unknown"}

Previous risk hints (if any):
existing_risk_score: ${pkg.versions[0].risk_score ?? "none"}
existing_risk_level: ${pkg.versions[0].risk_level ?? "none"}

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
