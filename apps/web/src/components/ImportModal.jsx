import { useState, useEffect, useRef } from 'react';
import { createLibrary, searchLibraries } from '../api/client.js';

const computeRisk = (match) => {
  const summaries = Array.isArray(match.licenseSummary ?? match.license_summary)
    ? match.licenseSummary ?? match.license_summary
    : [];
  const textParts = summaries.map(item =>
    typeof item === 'object' && item !== null && 'summary' in item ? item.summary : item
  );
  const emojiParts = summaries
    .map(item => (typeof item === 'object' && item !== null && item.emoji ? item.emoji : null))
    .filter(Boolean);
  const haystack = [match.license ?? '', ...textParts].join(' ').toLowerCase();

  const hasStrong =
    /agpl|gpl|sspl|copyleft/.test(haystack) || emojiParts.some(e => e.includes('🔴') || e.includes('🚫'));
  const hasWeak =
    /lgpl|mpl|cddl/.test(haystack) || emojiParts.some(e => e.includes('🟠') || e.includes('🟡'));
  const hasPermissive =
    /mit|apache|bsd|isc/.test(haystack) || emojiParts.some(e => e.includes('🟢') || e.includes('✅'));

  let level = 'unknown';
  let base = 50;
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
  const confidence = typeof match.confidence === 'number' ? match.confidence : 1;
  const score = Math.min(100, Math.max(0, Math.round(base * confidence)));
  return { level, score };
};

const RiskGauge = ({ score, level }) => {
  if (score === undefined || score === null || Number.isNaN(score)) return null;
  const clamped = Math.min(100, Math.max(0, Number(score)));
  const needlePos = `${clamped}%`;
  const label = level ? `Risk: ${level} (${clamped})` : `Risk score: ${clamped}`;
  return (
    <div className="risk-gauge" aria-label={label} title={label}>
      <div className="risk-gauge__track">
        <div className="risk-gauge__gradient" />
        <div className="risk-gauge__needle" style={{ left: needlePos }} />
      </div>
      <div className="risk-gauge__label">{label}</div>
    </div>
  );
};

function MatchCard({ match, onImport, onClose, disabled, discoveryQuery }) {
  const isExisting =
    Boolean(match._id || match.id || match.source === 'mongo' || match.existing);
  const risk = match.risk_level && match.risk_score !== undefined ? { level: match.risk_level, score: match.risk_score } : computeRisk(match);
  const handleImport = () => {
    if (isExisting) {
      onClose();
      return;
    }
    onImport(match);
  };
  const formattedSummary = (match.licenseSummary ?? match.license_summary ?? [])
    .map((item, idx) => {
      if (typeof item === 'object' && item !== null && 'summary' in item) {
        return { icon: item.emoji ?? '•', text: item.summary ?? '', key: idx };
      }
      if (typeof item === 'string') {
        return { icon: '•', text: item, key: idx };
      }
      return null;
    })
    .filter(Boolean)
    .filter(item => item.text.length > 0);
  const ecosystem = match.ecosystem ?? discoveryQuery?.ecosystem ?? 'Ecosystem belirtilmemiş';
  return (
    <div className="panel" style={{ marginBottom: '0.75rem' }}>
      <h4>{match.name ?? 'İsim bulunamadı'}</h4>
      <p className="eyebrow" style={{ marginTop: 0 }}>{ecosystem}</p>
      {match.description && <p>{match.description}</p>}
      {match.repository && (
        <p>
          <a href={match.repository} target="_blank" rel="noreferrer">Repo</a>
        </p>
      )}
      <div className="summary-tags">
        {match.version && <span>{match.version}</span>}
        {match.license && <span className="tag-muted">{match.license}</span>}
      </div>
      {risk && risk.score !== undefined && (
        <div style={{ marginTop: '0.75rem' }}>
          <RiskGauge score={risk.score} level={risk.level} />
        </div>
      )}
      {formattedSummary.length > 0 && (
        <div className="license-summary" style={{ marginTop: '0.5rem' }}>
          <p className="license-summary__title">Lisans özeti</p>
          <ul>
            {formattedSummary.map(item => (
              <li key={`${match.name}-ls-${item.key}`}>
                <span>{item.icon}</span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        style={{ marginTop: '0.5rem' }}
        onClick={handleImport}
        disabled={disabled}
      >
        {isExisting ? 'Kapat' : "DB'ye Ekle"}
      </button>
    </div>
  );
}

export default function ImportModal({ isOpen, onClose, onImported }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [importingId, setImportingId] = useState(null);
  const inputRef = useRef(null);

  const getMatchKey = (match) => `${match.name ?? ''}-${match.version || match.versionKey || ''}`.trim();

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
    if (!isOpen) {
      setQuery('');
      setResults(null);
      setError(null);
      setImportingId(null);
    }
  }, [isOpen]);

  const handleSearch = async (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    try {
      setLoading(true);
      setError(null);
      const data = await searchLibraries(query.trim());
      setResults(data);
      console.log('Search results:', data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const buildPayloadFromMatch = (match) => {
    const version = match.version ?? 'unknown';
    const evidence = match.evidence && Array.isArray(match.evidence) ? match.evidence.join(' ') : null;
    const notes = match.summary ?? evidence ?? null;
    const licenseSummary = Array.isArray(match.licenseSummary ?? match.license_summary)
      ? (match.licenseSummary ?? match.license_summary)
      : [];
    const licenseStructured = licenseSummary
      .map(item => {
        if (typeof item === 'object' && item !== null && 'summary' in item) {
          return { summary: item.summary ?? '', emoji: item.emoji ?? null };
        }
        return { summary: item, emoji: null };
      })
      .filter(entry => typeof entry.summary === 'string' && entry.summary.length > 0);
    const discoveryQuery = results?.discovery?.query ?? {};
    const risk = match.risk_level && match.risk_score !== undefined ? { level: match.risk_level, score: match.risk_score } : computeRisk(match);
    return {
      name: match.name ?? query,
      ecosystem: match.ecosystem ?? discoveryQuery.ecosystem ?? 'unknown',
      description: match.description,
      repository_url: match.repository,
      official_site: match.officialSite ?? match.official_site ?? null,
      versions: [
        {
          version,
          license_name: match.license ?? null,
          license_url: match.license_url ?? null,
          notes,
          license_summary: licenseStructured,
          evidence: Array.isArray(match.evidence) ? match.evidence : [],
          confidence: match.confidence ?? null,
          risk_level: risk.level,
          risk_score: risk.score
        }
      ]
    };
  };

  const handleImport = async (match) => {
    try {
      const importKey = getMatchKey(match);
      if (importingId === importKey) return;
      setImportingId(importKey);
      setLoading(true);
      setError(null);
      const payload = buildPayloadFromMatch(match);
      await createLibrary(payload);
      if (onImported) onImported();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setImportingId(null);
    }
  };

  if (!isOpen) return null;

  const dedupeByKey = (items, getKey) => {
    const seen = new Set();
    return items.filter(item => {
      const key = getKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const discoveryMatches = results?.discovery?.matches ?? [];
  const discoveryQuery = results?.discovery?.query ?? {};
  const source = results?.source;
  const mongoResults = source === 'mongo'
    ? dedupeByKey(results?.results ?? [], lib => lib.id ?? lib._id ?? `${lib.name}-${lib.versions?.[0]?.version ?? ''}`)
    : [];
  const mongoMatches = mongoResults.map(lib => ({
    ...lib,
    version: lib.versions?.[0]?.version,
    versionKey: lib.versions?.[0]?.version ?? '',
    license: lib.versions?.[0]?.license_name,
    licenseSummary: lib.versions?.[0]?.license_summary ?? lib.versions?.[0]?.licenseSummary ?? [],
    repository: lib.repository_url,
    officialSite: lib.official_site,
    ecosystem: lib.ecosystem,
    risk_level: lib.versions?.[0]?.risk_level ?? lib.risk_level,
    risk_score: lib.versions?.[0]?.risk_score ?? lib.risk_score,
    existing: true
  }));
  // If we have Mongo hits (source mongo), show only them; otherwise show MCP matches
  const combinedMatches =
    source === 'mcp'
      ? discoveryMatches
      : mongoMatches.length > 0
        ? mongoMatches
        : discoveryMatches;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={event => event.stopPropagation()} style={{ maxWidth: '900px' }}>
        <div className="modal-header">
          <h2>Import libraries</h2>
          <button className="close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form className="inline-form" onSubmit={handleSearch} style={{ marginBottom: '1rem' }}>
          <input
            ref={inputRef}
            placeholder='Örn: "dotenv": "^16.4.5"'
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button type="submit" disabled={loading}>Ara</button>
        </form>
        {loading && <p>Aranıyor...</p>}
        {error && <p className="error">{error}</p>}

        {mongoResults.length > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <h3>Mongo sonuçları</h3>
            {mongoMatches.map(match => (
              <MatchCard
                key={`${match.name}-${match.version || match.versionKey || ''}-${match.repository ?? match.officialSite ?? 'mongo'}`}
                match={match}
                onImport={handleImport}
                onClose={onClose}
                disabled={importingId === getMatchKey(match) || loading}
                discoveryQuery={discoveryQuery}
              />
            ))}
          </div>
        )}


        {mongoResults.length === 0 && combinedMatches.length > 0 && (
          <div>
            <h3>MCP keşif sonuçları</h3>
            {combinedMatches.map(match => (
              <MatchCard
                key={`${match.name}-${match.version}-${match.repository ?? match.officialSite ?? 'n/a'}`}
                match={match}
                onImport={handleImport}
                onClose={onClose}
                disabled={importingId === match.name || loading}
                discoveryQuery={discoveryQuery}
              />
            ))}
          </div>
        )}

        {!loading && !error && !mongoResults.length && !discoveryMatches.length && results && (
          <p>Sonuç bulunamadı.</p>
        )}
      </div>
    </div>
  );
}
