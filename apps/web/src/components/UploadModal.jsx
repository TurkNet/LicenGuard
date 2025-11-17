import React, { useRef, useState, useCallback, useEffect } from 'react';
import { analyzeFileUpload, searchLibraries, createLibrary } from '../api/client.js';

const RiskBar = ({ score }) => {
  if (score === undefined || score === null || Number.isNaN(score)) return null;
  const clamped = Math.min(100, Math.max(0, Number(score)));
  return (
    <div className="risk-gauge risk-gauge--compact risk-gauge--inline" title={`Risk score: ${clamped}`}>
      <div className="risk-gauge__track">
        <div className="risk-gauge__gradient" />
        <div className="risk-gauge__overlay" style={{ width: `${clamped}%` }} />
        <div className="risk-gauge__marker" style={{ left: `${clamped}%` }} />
      </div>
      <div className="risk-gauge__label">Risk: {clamped}</div>
    </div>
  );
};

export default function UploadModal({ isOpen, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [analyzeResult, setAnalyzeResult] = useState(null);
  const [analyzeError, setAnalyzeError] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [depJobs, setDepJobs] = useState([]);
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef(null);
  const allDone = depJobs.length > 0 && depJobs.every(job => job.status === 'done');

  const handleFileChange = (event) => {
    const selected = event.target.files?.[0];
    setFile(selected ?? null);
  };

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    const droppedFile = event.dataTransfer?.files?.[0];
    if (droppedFile) setFile(droppedFile);
  }, []);

  const handleDragOver = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const triggerFileDialog = () => {
    fileInputRef.current?.click();
  };

  const normalizeVersion = useCallback((value) => {
    if (!value) return null;
    const cleaned = value.replace(/^[~^><=\s]+/, '').trim();
    return cleaned || null;
  }, []);

  const computeRisk = useCallback((match = {}) => {
    const summaries = Array.isArray(match.licenseSummary) ? match.licenseSummary : [];
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
    return { level, score };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setFile(null);
      setAnalyzeResult(null);
      setAnalyzeError(null);
      setAnalyzing(false);
      setDepJobs([]);
      setProcessing(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!file) return;
    const run = async () => {
      setAnalyzing(true);
      setAnalyzeError(null);
      setAnalyzeResult(null);
      setDepJobs([]);
      try {
        const report = await analyzeFileUpload(file);
        setAnalyzeResult(report);
        if (Array.isArray(report?.dependencies)) {
          const jobs = report.dependencies.map((dep, idx) => ({
            id: `${dep.name}-${dep.version ?? ''}-${idx}`,
            name: dep.name,
            version: dep.version,
            status: 'pending',
            message: null,
            match: null,
            risk_score: null,
            risk_level: null
          }));
          setDepJobs(jobs);
        }
      } catch (err) {
        setAnalyzeError(err.message);
        setDepJobs([]);
      } finally {
        setAnalyzing(false);
      }
    };
    run();
  }, [file]);

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
            risk_score: v?.risk_score
          };
        } else if (res?.discovery?.matches?.length) {
          match = res.discovery.bestMatch ?? res.discovery.matches[0];
        }
        if (!match) {
          updateJob(next.id, { status: 'error', message: 'Eşleşme bulunamadı' });
          setProcessing(false);
          return;
        }
        const risk = {
          level: match.risk_level ?? computeRisk(match).level,
          score: match.risk_score ?? computeRisk(match).score
        };
        if (existing || res?.source === 'mongo') {
          updateJob(next.id, {
            status: 'done',
            message: 'Zaten kayıtlı',
            match,
            risk_level: risk.level,
            risk_score: risk.score
          });
          setProcessing(false);
          return;
        }
        updateJob(next.id, { status: 'importing', match, risk_level: risk.level, risk_score: risk.score });
        const payload = {
          name: match.name ?? next.name,
          ecosystem: match.ecosystem ?? res?.discovery?.query?.ecosystem ?? 'unknown',
          description: match.description,
          repository_url: match.repository ?? match.officialSite ?? null,
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
              risk_score: risk.score
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
  }, [depJobs, processing, computeRisk]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2>Dosya Yükle</h2>
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="panel" style={{ background: 'transparent', boxShadow: 'none', color: 'white' }}>
          <p>Dosyayı sürükleyip bırakın veya alana tıklayarak seçin.</p>
          <div
            className="dropzone"
            onClick={triggerFileDialog}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <span className="dropzone__hint">
              {file ? `Seçilen dosya: ${file.name}` : 'Dosya seçin veya buraya bırakın'}
            </span>
          </div>
          {file && analyzing && <p style={{ marginTop: '0.5rem' }}>Analiz ediliyor...</p>}
          {analyzeError && <p style={{ color: '#f87171', marginTop: '0.5rem' }}>{analyzeError}</p>}
        {analyzeResult && (
          <div style={{ marginTop: '1rem', background: 'rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '8px' }}>
            <p style={{ marginTop: 0, marginBottom: '0.5rem' }}>Analiz sonucu:</p>
            <p style={{ margin: 0, color: 'white' }}>
              Manager/Ekosistem: <strong>{analyzeResult.packageManager ?? analyzeResult.ecosystem ?? 'unknown'}</strong>
              </p>
              {depJobs.length > 0 ? (
                <ul style={{ marginTop: '0.4rem', paddingLeft: 0, color: 'white', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {depJobs.map(job => (
                    <li key={job.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', background: 'rgba(255,255,255,0.04)', padding: '0.5rem 0.75rem', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                        <span style={{ fontWeight: 700 }}>{job.name}</span>
                        <span style={{ color: '#cbd5f5', fontSize: '0.9rem' }}>{job.version ?? 'versiyon belirtilmedi'}</span>
                        {job.message && <span style={{ color: '#cbd5f5', fontSize: '0.85rem' }}>{job.message}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {job.risk_score !== null && job.risk_score !== undefined && <RiskBar score={job.risk_score} />}
                        {job.status === 'done' && <span style={{ color: '#22c55e' }}>✓</span>}
                        {job.status === 'error' && <span style={{ color: '#f87171' }}>!</span>}
                        {job.status === 'searching' && <span style={{ color: '#eab308' }}>Aranıyor…</span>}
                        {job.status === 'importing' && <span style={{ color: '#38bdf8' }}>Ekleniyor…</span>}
                        {job.status === 'pending' && <span style={{ color: '#94a3b8' }}>Bekliyor</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ color: '#cbd5f5', marginTop: '0.5rem' }}>Bağımlılık bulunamadı veya henüz desteklenmiyor.</p>
              )}
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
