import React, { useCallback, useEffect, useRef, useState } from 'react';
import { scanRepository, searchLibraries, createLibrary } from '../api/client.js';

const RiskBar = ({ score, explanation }) => {
  if (score === undefined || score === null || Number.isNaN(score)) return null;
  const clamped = Math.min(100, Math.max(0, Number(score)));
  const tooltip = explanation || `Risk score: ${clamped}`;
  return (
    <div className="risk-gauge risk-gauge--compact risk-gauge--inline" title={tooltip}>
      <div className="risk-gauge__track">
        <div className="risk-gauge__gradient" />
        <div className="risk-gauge__overlay" style={{ width: `${clamped}%` }} />
        <div className="risk-gauge__marker" style={{ left: `${clamped}%` }} />
      </div>
      <div className="risk-gauge__label">Risk: {clamped}</div>
    </div>
  );
};

export default function RepoLinkModal({ isOpen, onClose, onImported }) {
  const [repoUrl, setRepoUrl] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const [depJobs, setDepJobs] = useState([]);
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef(null);
  const hasActiveWork =
    loading ||
    processing ||
    depJobs.some(job => ['pending', 'searching', 'importing'].includes(job.status));

  const allDone = depJobs.length > 0 && depJobs.every(job => job.status === 'done');
  const formatVersion = (job) => {
    const matchedVersion = job.match?.version;
    if (job.version) return job.version;
    if (matchedVersion) return `(N/A) -> ${matchedVersion}/latest`;
    return '(N/A)';
  };

  const resetState = () => {
    setRepoUrl('');
    setError(null);
    setFiles([]);
    setDepJobs([]);
    setLoading(false);
    setProcessing(false);
  };

  useEffect(() => {
    if (!isOpen) {
      resetState();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const isValidUrl = (value) => {
    try {
      const url = new URL(value);
      return Boolean(url.protocol && url.host);
    } catch {
      return false;
    }
  };

  const normalizeVersion = useCallback((value) => {
    if (!value) return null;
    const cleaned = value.replace(/^[~^><=\s]+/, '').trim();
    return cleaned || null;
  }, []);

  const computeRisk = useCallback((match = {}) => {
    const summaries = Array.isArray(match.licenseSummary ?? match.license_summary)
      ? (match.licenseSummary ?? match.license_summary)
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
    if (hasStrong) { level = 'high'; base = 90; }
    else if (hasWeak) { level = 'medium'; base = 60; }
    else if (hasPermissive) { level = 'low'; base = 10; }
    const confidence = typeof match.confidence === 'number' ? match.confidence : 1;
    const score = Math.min(100, Math.max(0, Math.round(base * confidence)));
    let explanation = `${level} risk — score ${score}/100`;
    if (hasStrong) explanation += ' (strong copyleft belirtileri)';
    else if (hasWeak) explanation += ' (zayıf copyleft belirtileri)';
    else if (hasPermissive) explanation += ' (permissive lisans işaretleri)';
    return { level, score, explanation };
  }, []);

  const handleChange = (e) => {
    const value = e.target.value;
    setRepoUrl(value);
    if (value && !isValidUrl(value)) {
      setError('Lütfen geçerli bir URL girin (http/https).');
    } else {
      setError(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!repoUrl || error) return;
    try {
      setLoading(true);
      setError(null);
      setFiles([]);
      setDepJobs([]);
      const res = await scanRepository(repoUrl);
      const scannedFiles = res.files ?? [];
      setFiles(scannedFiles);
      const jobs = [];
      scannedFiles.forEach((file, fIdx) => {
        const deps = Array.isArray(file?.report?.dependencies) ? file.report.dependencies : [];
        deps.forEach((dep, dIdx) => {
          jobs.push({
            id: `${file.path}-${dep.name}-${dep.version ?? ''}-${fIdx}-${dIdx}`,
            file: file.path,
            name: dep.name,
            version: normalizeVersion(dep.version),
            status: 'pending',
            message: null,
            match: null,
            risk_score: dep.risk_score ?? null,
            risk_level: dep.risk_level ?? null,
            risk_score_explanation: dep.risk_score_explanation ?? null
          });
        });
      });
      setDepJobs(jobs);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const processNext = async () => {
      if (processing) return;
      const next = depJobs.find(job => job.status === 'pending');
      if (!next) return;
      setProcessing(true);
      const updateJob = (id, patch) =>
        setDepJobs(jobs => jobs.map(j => (j.id === id ? { ...j, ...patch } : j)));
      const q = next.version ? `${next.name} ${next.version}` : next.name;
      try {
        updateJob(next.id, { status: 'searching', message: null });
        const res = await searchLibraries(q);
        let match = null;
        let existing = false;

        if (res?.source === 'mongo' && Array.isArray(res?.results) && res.results.length > 0) {
          existing = true;
          const lib = res.results[0];
          const v = lib.versions?.[0];
          match = {
            name: lib.name,
            version: v?.version,
            ecosystem: lib.ecosystem,
            description: lib.description,
            repository: lib.repository_url,
            license: v?.license_name,
            license_url: v?.license_url,
            licenseSummary: v?.license_summary ?? [],
            evidence: v?.evidence ?? [],
            confidence: v?.confidence,
            risk_level: v?.risk_level,
            risk_score: v?.risk_score,
            risk_score_explanation: v?.risk_score_explanation
          };
        } else if (res?.source === 'mcp' && Array.isArray(res?.results) && res.results.length > 0) {
          const lib = res.results[0];
          const v = lib.versions?.[0];
          match = {
            name: lib.name,
            version: v?.version,
            ecosystem: lib.ecosystem,
            description: lib.description,
            repository: lib.repository_url,
            license: v?.license_name,
            license_url: v?.license_url,
            licenseSummary: v?.license_summary ?? [],
            evidence: v?.evidence ?? [],
            confidence: v?.confidence,
            risk_level: v?.risk_level,
            risk_score: v?.risk_score,
            risk_score_explanation: v?.risk_score_explanation,
            officialSite: lib.officialSite
          };
        } else if (res?.discovery?.matches?.length) {
          match = res.discovery.bestMatch ?? res.discovery.matches[0];
        }

        if (!match) {
          updateJob(next.id, { status: 'error', message: 'Eşleşme bulunamadı' });
          setProcessing(false);
          return;
        }

        const computedRisk = computeRisk(match);
        const risk = {
          level: match.risk_level ?? computedRisk.level,
          score: match.risk_score ?? computedRisk.score,
          explanation: match.risk_score_explanation ?? computedRisk.explanation
        };

        if (existing || res?.source === 'mongo') {
          updateJob(next.id, {
            status: 'done',
            message: 'Zaten kayıtlı',
            match,
            risk_level: risk.level,
            risk_score: risk.score,
            risk_score_explanation: risk.explanation
          });
          setProcessing(false);
          return;
        }

        updateJob(next.id, { status: 'importing', match, risk_level: risk.level, risk_score: risk.score, risk_score_explanation: risk.explanation });
        const payload = {
          name: match.name ?? next.name,
          ecosystem: match.ecosystem ?? res?.discovery?.query?.ecosystem ?? 'unknown',
          description: match.description,
          repository_url: match.repository ?? match.officialSite ?? null,
          officialSite: match.officialSite ?? match.repository ?? null,
          versions: [
            {
              version: normalizeVersion(match.version ?? next.version) ?? 'unknown',
              license_name: match.license ?? null,
              license_url: match.license_url ?? null,
              notes: match.summary ?? null,
              license_summary: Array.isArray(match.licenseSummary)
                ? match.licenseSummary
                    .map(item =>
                      typeof item === 'object' && item !== null
                        ? { summary: item.summary ?? '', emoji: item.emoji ?? null }
                        : { summary: item, emoji: null }
                    )
                    .filter(entry => typeof entry.summary === 'string' && entry.summary.length > 0)
                : [],
              confidence: match.confidence ?? null,
              evidence: Array.isArray(match.evidence) ? match.evidence : [],
              risk_level: risk.level,
              risk_score: risk.score,
              risk_score_explanation: risk.explanation
            }
          ]
        };

        await createLibrary(payload);
        updateJob(next.id, { status: 'done', message: 'Eklendi', match });
        if (onImported) onImported();
      } catch (err) {
        updateJob(next.id, { status: 'error', message: err.message });
      } finally {
        setProcessing(false);
      }
    };
    processNext();
  }, [depJobs, processing, computeRisk, normalizeVersion, onImported]);

  if (!isOpen) return null;

  const jobsByFile = (path) => depJobs.filter(job => job.file === path);
  const handleSafeClose = () => {
    if (hasActiveWork) return;
    if (onImported) onImported();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleSafeClose}>
      <div className="modal modal--wide" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2>Repo Linki</h2>
          <button className="close" onClick={handleSafeClose} aria-label="Close" disabled={hasActiveWork}>
            ✕
          </button>
        </div>
        <div className="panel" style={{ background: 'transparent', boxShadow: 'none', color: 'white' }}>
          <p>Repo linkini girin, link geçerliyse tarayalım.</p>
          <form
            className="inline-form"
            style={{ marginBottom: '1rem' }}
            onSubmit={handleSubmit}
          >
            <input
              type="url"
              placeholder="https://github.com/org/repo"
              value={repoUrl}
              onChange={handleChange}
              ref={inputRef}
            />
            <div style={{ textAlign: 'right' }}>
              <button type="submit" disabled={Boolean(error) || !repoUrl || loading} className="button">
                {loading ? 'Taranıyor…' : 'Kontrol'}
              </button>
            </div>
          </form>
          {error && <p className="error">{error}</p>}
          {files.length > 0 && (
            <div style={{ marginTop: '1rem', background: 'rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '12px' }}>
              <p style={{ marginTop: 0, marginBottom: '0.5rem' }}>Bulunan dependency dosyaları:</p>
              <ul style={{ margin: 0, paddingLeft: 0, color: 'white', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {files.map((f, idx) => {
                  const deps = jobsByFile(f.path);
                  return (
                    <li
                      key={`${f.path}-${idx}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.4rem',
                        background: 'rgba(255,255,255,0.04)',
                        padding: '0.65rem 0.8rem',
                        borderRadius: '10px'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                        <span style={{ fontWeight: 700 }}>{f.path}</span>
                        {f.url && (
                          <a href={f.url} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>
                            {f.url}
                          </a>
                        )}
                      </div>
                      {deps.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          {deps.map(dep => (
                            <li
                              key={dep.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '0.75rem',
                                background: 'rgba(255,255,255,0.04)',
                                padding: '0.5rem 0.75rem',
                                borderRadius: '8px'
                              }}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                                <span style={{ fontWeight: 700 }}>{dep.name}</span>
                                <span style={{ color: '#cbd5f5', fontSize: '0.9rem' }}>{formatVersion(dep)}</span>
                                {dep.message && <span style={{ color: '#cbd5f5', fontSize: '0.85rem' }}>{dep.message}</span>}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {dep.risk_score !== null && dep.risk_score !== undefined && (
                                  <RiskBar score={dep.risk_score} explanation={dep.risk_score_explanation || dep.match?.risk_score_explanation} />
                                )}
                                {dep.status === 'done' && <span style={{ color: '#22c55e' }}>✓</span>}
                                {dep.status === 'error' && <span style={{ color: '#f87171' }}>!</span>}
                                {dep.status === 'searching' && <span style={{ color: '#eab308' }}>Aranıyor…</span>}
                                {dep.status === 'importing' && <span style={{ color: '#38bdf8' }}>Ekleniyor…</span>}
                                {dep.status === 'pending' && <span style={{ color: '#94a3b8' }}>Bekliyor</span>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span style={{ color: '#cbd5f5' }}>Bağımlılık bulunamadı.</span>
                      )}
                      {f.report?.error && <span style={{ color: '#f87171' }}>Hata: {f.report.error}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {allDone && (
            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="button" type="button" onClick={onClose}>
                Kapat
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
