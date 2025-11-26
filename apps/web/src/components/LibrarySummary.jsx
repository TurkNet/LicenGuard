import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';


const getLicenseGuide = (licenseName) => {
  if (!licenseName) return null;
  return licenseName.toLowerCase() ?? null;
};

const normalizeVersion = (value = '') => value.replace(/^[~^><=\s]+/, '').replace(/^v/i, '').trim();
const compareVersionsDesc = (a, b) => {
  const left = normalizeVersion(a.version || '');
  const right = normalizeVersion(b.version || '');
  const split = (v) => v.split('.').map(part => {
    const num = Number(part);
    return Number.isFinite(num) ? num : part;
  });
  const lParts = split(left);
  const rParts = split(right);
  const len = Math.max(lParts.length, rParts.length);
  for (let i = 0; i < len; i += 1) {
    const l = lParts[i] ?? 0;
    const r = rParts[i] ?? 0;
    if (typeof l === 'number' && typeof r === 'number') {
      if (l !== r) return r - l; // desc numeric
    } else {
      const lStr = String(l);
      const rStr = String(r);
      if (lStr !== rStr) return rStr.localeCompare(lStr); // desc lexicographic fallback
    }
  }
  return 0;
};

const describeComponentLevel = (score, max) => {
  if (score === null || score === undefined) {
    return {
      label: 'N/A',
      icon: '⬜',
      bg: 'linear-gradient(135deg, #cbd5e1, #94a3b8)',
      border: '#94a3b8',
      text: '#111827'
    };
  }
  const ratio = score / max;
  if (ratio >= 0.7) {
    return {
      label: 'critical',
      icon: '🟥',
      bg: 'linear-gradient(135deg, #f87171, #e74c3c)',
      border: '#e74c3c',
      text: '#fff'
    };
  }
  if (ratio >= 0.5) {
    return {
      label: 'high',
      icon: '🟧',
      bg: 'linear-gradient(135deg, #f59e0b, #d97706)',
      border: '#e67e22',
      text: '#fff'
    };
  }
  if (ratio >= 0.3) {
    return {
      label: 'medium',
      icon: '🟨',
      bg: 'linear-gradient(135deg, #f8d86b, #f1c40f)',
      border: '#eab308',
      text: '#111827'
    };
  }
  return {
    label: 'low',
    icon: '🟩',
    bg: 'linear-gradient(135deg, #34d399, #22c55e)',
    border: '#22c55e',
    text: '#0f172a'
  };
};

const RiskGauge = ({ score, level, compact = false, needleless = false, explanation }) => {
  if (score === undefined || score === null || Number.isNaN(score)) return null;
  const clamped = Math.min(100, Math.max(0, Number(score)));
  const needlePos = `${clamped}%`;
  const label = level ? `${level} (${clamped})` : `${clamped}`;
  const tooltip = explanation || `Risk: ${label}`;
  return (
    <div
      className={`risk-gauge ${compact ? 'risk-gauge--compact' : ''}`}
      aria-label={`Risk: ${label}`}
      title={tooltip}
    >
      <div className="risk-gauge__track">
        <div className="risk-gauge__gradient" />
        {!needleless && <div className="risk-gauge__needle" style={{ left: needlePos }} />}
        {needleless && (
          <div className="risk-gauge__overlay" style={{ width: needlePos }} />
        )}
        {needleless && <div className="risk-gauge__marker" style={{ left: needlePos }} />}
      </div>
      <div className="risk-gauge__label">Risk: {label}</div>
    </div>
  );
};

export default function LibrarySummary({ libraries = [] }) {
  const [selectedLibraryId, setSelectedLibraryId] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const shellRef = useRef(null);
  const trackRef = useRef(null);
  const [shellHeight, setShellHeight] = useState('auto');

  const selectedLibrary = useMemo(
    () => libraries.find(li => (li.id ?? li._id) === selectedLibraryId),
    [libraries, selectedLibraryId]
  );

  const sortedSelectedLibraryVersions = useMemo(() => {
    if (!selectedLibrary) return [];
    return [...selectedLibrary.versions].sort(compareVersionsDesc);
  }, [selectedLibrary]);

  const selectedVersion = useMemo(() => {
    if (!selectedLibrary) return null;
    const target = sortedSelectedLibraryVersions.find(version => version.version === selectedVersionId);
    return target ?? null;
  }, [selectedLibrary, selectedVersionId, sortedSelectedLibraryVersions]);

  const versionRiskComponents = useMemo(() => {
    if (!selectedVersion) return [];
    const get = (key) => {
      if (selectedVersion[key] !== undefined) return selectedVersion[key];
      if (selectedVersion.risk_details && selectedVersion.risk_details[key] !== undefined) {
        return selectedVersion.risk_details[key];
      }
      return null;
    };
    return [
      { label: 'License Risk', score: get('license_risk_score'), max: 40 },
      { label: 'Security Risk', score: get('security_risk_score'), max: 30 },
      { label: 'Maintenance Risk', score: get('maintenance_risk_score'), max: 20 },
      { label: 'Usage Context Risk', score: get('usage_context_risk_score'), max: 10 }
    ];
  }, [selectedVersion]);

  useEffect(() => {
    if (!selectedLibrary) {
      setSelectedVersionId(null);
      return;
    }
    // reset version selection when switching library so user chooses explicitly
    setSelectedVersionId(null);
  }, [selectedLibrary]);

  // Measure and set the shell height to match the active panel
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const track = trackRef.current;
    if (!shell || !track) return;

    const compute = () => {
      // Determine active panel index: 0=list, 1=versions, 2=detail
      let index = 0;
      if (selectedLibrary) index = 1;
      if (selectedLibrary && selectedVersion) index = 2;

      // panels are direct children of track: find nth child
      const panels = Array.from(track.querySelectorAll('section'));
      const active = panels[index];
      if (!active) {
        shell.style.height = 'auto';
        setShellHeight('auto');
        return;
      }

      // measure the active panel's height; include computed margins and add extra padding
      const style = window.getComputedStyle(active);
      const marginTop = parseFloat(style.marginTop) || 0;
      const marginBottom = parseFloat(style.marginBottom) || 0;
      const contentHeight = Math.ceil(active.scrollHeight || active.offsetHeight || active.getBoundingClientRect().height);
      const extra = 64; // extra space so bottom elements aren't clipped
      const total = Math.ceil(contentHeight + marginTop + marginBottom + extra);

      // Apply height to shell to force it to match active panel
      shell.style.height = `${total}px`;
      shell.style.minHeight = `${total}px`;
      setShellHeight(`${total}px`);

      // After transition ends, only switch to auto if the measured desired total
      // still matches the current shell height (within a small delta). This avoids
      // the container snapping back to an incorrect height when content/layout
      // changes during the transition.
      const onTransitionEnd = (ev) => {
        if (ev.propertyName !== 'height') return;
        try {
          // Recompute desired total for robustness
          const panelsNow = Array.from(track.querySelectorAll('section'));
          const activeNow = panelsNow[index] || panelsNow[0];
          const styleNow = activeNow ? window.getComputedStyle(activeNow) : null;
          const mt = styleNow ? parseFloat(styleNow.marginTop) || 0 : 0;
          const mb = styleNow ? parseFloat(styleNow.marginBottom) || 0 : 0;
          const desired = activeNow ? Math.ceil((activeNow.scrollHeight || activeNow.offsetHeight || activeNow.getBoundingClientRect().height) + mt + mb + extra) : total;
          const currentShellPx = Math.round(parseFloat(shell.style.height) || shell.getBoundingClientRect().height || 0);
          const delta = Math.abs(currentShellPx - desired);
          if (delta <= 8) {
            // sizes match closely; safe to switch to auto for responsiveness
            shell.style.height = 'auto';
            shell.style.minHeight = '';
            setShellHeight('auto');
          } else {
            // Keep the computed size (and minHeight) to avoid collapse; update minHeight
            shell.style.height = `${desired}px`;
            shell.style.minHeight = `${desired}px`;
            setShellHeight(`${desired}px`);
          }
        } catch (e) {
          // If anything goes wrong, avoid breaking layout: keep current px height
        }
      };
      // Use delegated listener to ensure it fires once per transition
      shell.addEventListener('transitionend', onTransitionEnd, { once: true });
    };

    // compute now
    compute();

    // recompute on resize and when fonts/images load
    window.addEventListener('resize', compute);
    const ro = new ResizeObserver(compute);
    ro.observe(track);

    return () => {
      window.removeEventListener('resize', compute);
      try { ro.disconnect(); } catch (e) {}
    };
  }, [selectedLibrary, selectedVersion, selectedVersionId, libraries]);

  if (!libraries.length) {
    return null;
  }

  return (
    <div ref={shellRef} className="panel summary-panel master-detail-shell" style={{ alignItems: 'flex-start', height: shellHeight }}>
      <div className="summary-header">
        <h2>Library</h2>
      </div>
      <div
        className={`master-detail-track ${
          selectedLibrary
            ? selectedVersion
              ? 'master-detail-track--version-detail'
              : 'master-detail-track--versions'
            : ''
        }`}
        ref={trackRef}
        style={{ alignItems: 'flex-start', height: 'auto' }}
        >
        <section className="master-panel panel" style={{ alignSelf: 'flex-start' }}>
          <div className="version-detail">
            <ul className="summary-list summary-list--clickable summary-list--grid3">
              {libraries.map(library => {
                const libraryId = library.id ?? library._id;
                const sortedVersions = [...library.versions].sort(compareVersionsDesc);
                const recentVersions = sortedVersions.slice(0, 6); // highest on the left
                return (
                  <li key={libraryId}>
                    <button type="button" className="summary-row" onClick={() => setSelectedLibraryId(libraryId)}>
                      <div className="summary-row__cell summary-row__body">
                        <div className="summary-row__field">
                          <span className="summary-row__label">Name :</span>
                          <span className="summary-row__value summary-row__value--name">{library.name}</span>
                        </div>
                        <div className="summary-row__field">
                          <span className="summary-row__label">Ecosystem :</span>
                          <span className="summary-row__value summary-row__value--ecosystem">{library.ecosystem}</span>
                        </div>
                        <div className="summary-row__field">
                          <span className="summary-row__label">Description :</span>
                          <span
                            className="summary-row__value summary-row__value--description"
                            title={library.description ?? 'Description pending'}
                          >
                            {library.description ?? 'Description pending'}
                          </span>
                        </div>
                        {(library.officialSite) && (
                          <div className="summary-row__field">
                            <span className="summary-row__label">Official site :</span>
                            <span className="summary-row__value summary-row__value--link">
                              <a
                                href={library.officialSite}
                                target="_blank"
                                rel="noreferrer"
                                className="summary-row__link summary-row__link--prominent"
                              >
                                {library.officialSite}
                              </a>
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="summary-row__cell summary-row__versions">
                        {recentVersions.map(version => (
                          <span key={`${libraryId}-${version.version}`}>{version.version}</span>
                        ))}
                        {!library.versions.length && <span className="tag-muted">No versions yet</span>}
                      </div>
                      <div className="summary-row__cell summary-row__chevron" aria-hidden="true">
                        →
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="panel version-panel version-panel--list" style={{ alignSelf: 'flex-start' }}>
          {selectedLibrary ? (
            <div className="version-detail">
              <div className="detail-header">
                <button type="button" className="ghost-button" onClick={() => setSelectedLibraryId(null)}>
                  ← Listeye dön
                </button>
              </div>
              <div className="library-meta" style={{ marginBottom: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {[
                  { label: 'Name:', value: selectedLibrary.name },
                  { label: 'Ecosystem:', value: selectedLibrary.ecosystem },
                  { label: 'Description:', value: selectedLibrary.description ?? '—' },
                  {
                    label: 'Repository:',
                    value: selectedLibrary.repository_url
                      ? <a className="library-meta__value" href={selectedLibrary.repository_url} target="_blank" rel="noreferrer">{selectedLibrary.repository_url}</a>
                      : '—'
                  },
                  {
                    label: 'Official site:',
                    value: selectedLibrary.officialSite || selectedLibrary.official_site
                      ? <a className="library-meta__value" href={selectedLibrary.officialSite ?? selectedLibrary.official_site} target="_blank" rel="noreferrer">{selectedLibrary.officialSite ?? selectedLibrary.official_site}</a>
                      : '—'
                  },
                  {
                    label: 'Created:',
                    value: selectedLibrary.created_at ? new Date(selectedLibrary.created_at).toLocaleString() : '—'
                  },
                  {
                    label: 'Updated:',
                    value: selectedLibrary.updated_at ? new Date(selectedLibrary.updated_at).toLocaleString() : '—'
                  }
                ].map(row => (
                  <div key={row.label} className="library-meta__row" style={{ display: 'flex', gap: '0.5rem' }}>
                    <span className="library-meta__label" style={{ fontWeight: 600, minWidth: '120px' }}>{row.label}</span>
                    <span className="library-meta__value" style={{ flex: 1 }}>{row.value}</span>
                  </div>
                ))}
              </div>
              <ul className="version-list">
                {sortedSelectedLibraryVersions.map(version => {
                  const isSelected = selectedVersionId === version.version;
                  const riskScore = version.risk_score ?? null;
                  const riskLevel = version.risk_level ?? null;
                  const riskExplanation = version.risk_score_explanation ?? null;
                  return (
                    <li key={`${selectedLibrary.id ?? selectedLibrary._id}-${version.version}`}>
                      <button
                        type="button"
                        className={`version-row ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => setSelectedVersionId(version.version)}
                      >
                        <div>
                          <strong>{version.version}</strong>
                          <p>{version.license_name ?? 'License pending'}</p>
                        </div>
                        <div className="version-row__meta">
                          {riskScore !== null && (
                            <div className="version-row__risk">
                              <RiskGauge
                                score={riskScore}
                                level={riskLevel}
                                explanation={riskExplanation}
                                compact
                                needleless
                              />
                            </div>
                          )}
                          <span className="version-row__chevron" aria-hidden="true">→</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
                {!selectedLibrary.versions.length && <p>Henüz versiyon eklenmedi.</p>}
              </ul>
            </div>
          ) : (
            <p className="detail-placeholder">Detay görmek için listeden bir kütüphane seçin.</p>
          )}
        </section>

        <section className="panel version-panel version-panel--detail">
          {selectedVersion ? (
            <div className="version-detail">
              <div className="detail-header">
                <button type="button" className="ghost-button" onClick={() => setSelectedVersionId(null)}>
                  ← Versiyon listesine dön
                </button>
              </div>
              <dl>
                <div>
                  <dt>Lisans</dt>
                  <dd>{selectedVersion.license_name ?? 'Belirtilmemiş'}</dd>
                </div>
                <div>
                  <dt>License URL</dt>
                  <dd>
                    {selectedVersion.license_url ? (
                      <a href={selectedVersion.license_url} target="_blank" rel="noreferrer">
                        {selectedVersion.license_url}
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                {(selectedVersion.risk_score !== undefined && selectedVersion.risk_score !== null) && (
                  <div>
                    <dt>Risk</dt>
                    <dd>
                      <RiskGauge
                        score={selectedVersion.risk_score}
                        level={selectedVersion.risk_level}
                        explanation={selectedVersion.risk_score_explanation}
                        compact
                        needleless
                      />
                    </dd>
                  </div>
                )}
                {selectedVersion && versionRiskComponents.length > 0 && (
                  <div>
                    <dt style={{ alignSelf: 'flex-start' }}>Risk Components</dt>
                    <dd style={{ textAlign: 'right', marginTop: '0.35rem', lineHeight: 1.5 }}>
                      {versionRiskComponents.map(comp => {
                        const hasScore = comp.score !== null && comp.score !== undefined;
                        const band = describeComponentLevel(comp.score, comp.max);
                        const badgeStyle = {
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: band.text,
                          minWidth: '90px',
                          justifyContent: 'center'
                        };
                        return (
                          <div
                            key={comp.label}
                            style={{
                              display: 'flex',
                              justifyContent: 'flex-end',
                              alignItems: 'center',
                              gap: '10px',
                              marginBottom: '4px'
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>{comp.label}:</span>
                            <span style={{ minWidth: '88px', textAlign: 'right'}}>
                              {hasScore ? `${comp.score} / ${comp.max}` : '—'}
                            </span>
                            <span style={badgeStyle}>
                              {band.icon} {band.label.toUpperCase()}
                            </span>
                          </div>
                        );
                      })}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Notlar</dt>
                  <dd>{selectedVersion.notes ?? 'Not bulunamadı'}</dd>
                </div>
              </dl>
              <div className="license-summary">
                {(() => {
                  const guide = getLicenseGuide(selectedVersion.license_name);
                  const customSummary = selectedVersion.license_summary || [];
                  const structuredBullets = Array.isArray(customSummary)
                    ? customSummary
                        .map(item =>
                          typeof item === 'object' && item !== null && 'summary' in item
                            ? { icon: item.emoji ?? '•', text: item.summary }
                            : { icon: '•', text: item }
                        )
                        .filter(b => typeof b.text === 'string' && b.text.length > 0)
                    : [];
                  const bullets = structuredBullets.length ? structuredBullets : guide?.bullets;
                  const title = guide?.title ?? 'Lisans özeti';
                  if (!bullets || !bullets.length) return null;
                  return (
                    <>
                      <p className="license-summary__title">{title}</p>
                      <ul>
                        {bullets.map((bullet, index) => (
                          <li key={`${selectedVersion.version}-${index}`}>
                            <span>{bullet.icon}</span>
                            <span>{bullet.text}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  );
                })()}
              </div>
            </div>
          ) : (
            <p className="detail-placeholder">Bir versiyon seçerek detayları görüntüleyin.</p>
          )}
        </section>
      </div>
    </div>
  );
}
