import { useState } from 'react';
import { createLibrary, searchLibraries } from '../api/client.js';

const classifySummary = (summary = []) =>
  summary.map((text, idx) => {
    const lower = text.toLowerCase();
    let icon = '•';
    if (
      lower.includes('izin verir') ||
      lower.includes('allowed') ||
      lower.includes('permitted') ||
      lower.includes('serbest') ||
      lower.includes('permits') ||
      lower.includes('dağıtabilirsiniz')
    ) {
      icon = '✅';
    } else if (
      lower.includes('gereklidir') ||
      lower.includes('required') ||
      lower.includes('sınırlı') ||
      lower.includes('notice') ||
      lower.includes('attribution')
    ) {
      icon = '⚠️';
    }
    return { icon, text: text.replace(/^([✅⚠️•]\s*)/, '').trim(), key: idx };
  });

function MatchCard({ match, onImport, onClose, disabled, discoveryQuery }) {
  const isExisting =
    Boolean(match._id || match.id || match.source === 'mongo' || match.existing);
  const handleImport = () => {
    if (isExisting) {
      onClose();
      return;
    }
    onImport(match);
  };
  const formattedSummary = classifySummary(match.licenseSummary || match.license_summary || []);
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

  // reset state when modal closes
  if (!isOpen && (query || results || error || importingId)) {
    setQuery('');
    setResults(null);
    setError(null);
    setImportingId(null);
  }

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
    const licenseSummary = match.licenseSummary ?? match.license_summary ?? [];
    const evidence = match.evidence && Array.isArray(match.evidence) ? match.evidence.join(' ') : null;
    const notes = match.summary ?? evidence ?? null;
    const formattedSummary = classifySummary(licenseSummary).map(item => `${item.icon} ${item.text}`);
    const discoveryQuery = results?.discovery?.query ?? {};
    return {
      name: match.name ?? query,
      ecosystem: match.ecosystem ?? discoveryQuery.ecosystem ?? 'unknown',
      description: match.description,
      repository_url: match.repository,
      versions: [
        {
          version,
          license_name: match.license ?? null,
          license_url: match.license_url ?? null,
          notes,
          license_summary: Array.from(new Set(formattedSummary))
        }
      ]
    };
  };

  const handleImport = async (match) => {
    try {
      if (importingId === match.name) return;
      setImportingId(match.name);
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
  const mongoResults = dedupeByKey(results?.results ?? [], lib => lib.id ?? lib._id ?? `${lib.name}-${lib.versions?.[0]?.version ?? ''}`);
  const mongoMatches = mongoResults.map(lib => ({
    ...lib,
    version: lib.versions?.[0]?.version,
    license: lib.versions?.[0]?.license_name,
    licenseSummary: lib.versions?.[0]?.license_summary ?? lib.versions?.[0]?.licenseSummary ?? [],
    repository: lib.repository_url,
    ecosystem: lib.ecosystem,
    existing: true
  }));
  // If we have Mongo hits, show only them to avoid duplicate imports from MCP results
  const combinedMatches = mongoMatches.length > 0 ? mongoMatches : discoveryMatches;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={event => event.stopPropagation()} style={{ maxWidth: '900px' }}>
        <div className="modal-header">
          <h2>Import libraries</h2>
          <button className="close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form className="inline-form" onSubmit={handleSearch} style={{ marginBottom: '1rem' }}>
          <input
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
            <ul className="summary-list summary-list--static">
              {mongoResults.map(lib => (
                <li key={lib.id ?? lib._id ?? `${lib.name}-${lib.versions?.[0]?.version ?? ''}`}>
                  <strong>{lib.name}</strong>
                  <div className="summary-tags">
                    {lib.versions.map(v => <span key={`${lib.id ?? lib._id}-${v.version}`}>{v.version}</span>)}
                  </div>
                  {lib.versions?.length > 0 && lib.versions[0].license_summary?.length > 0 && (
                    <div className="license-summary" style={{ marginTop: '0.4rem' }}>
                      <p className="license-summary__title">Lisans özeti</p>
                      <ul>
                        {classifySummary(lib.versions[0].license_summary).map(item => (
                          <li key={`${lib.id ?? lib._id}-ls-${item.key}`}>
                            <span>{item.icon}</span>
                            <span>{item.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
                  <button
        style={{ marginTop: '0.5rem' }}
        onClick={onClose}
        >
        Kapat
      </button>
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
