import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const LICENSE_GUIDES = {
  'bsd-2-clause': {
    title: 'BSD-2-Clause lisansı',
    bullets: [
      { icon: '✅', text: 'Ticari kullanıma izin verir' },
      { icon: '✅', text: 'Değiştirilmiş versiyonları dağıtabilirsiniz' },
      { icon: '✅', text: 'Özel kullanım için serbest' },
      { icon: '⚠️', text: 'Lisans ve telif hakkı bildirimi gereklidir' }
    ]
  }
};

const getLicenseGuide = (licenseName) => {
  if (!licenseName) return null;
  return LICENSE_GUIDES[licenseName.toLowerCase()] ?? null;
};

const RiskGauge = ({ score, level, compact = false, needleless = false }) => {
  if (score === undefined || score === null || Number.isNaN(score)) return null;
  const clamped = Math.min(100, Math.max(0, Number(score)));
  const needlePos = `${clamped}%`;
  const label = level ? `${level} (${clamped})` : `${clamped}`;
  return (
    <div className={`risk-gauge ${compact ? 'risk-gauge--compact' : ''}`} aria-label={`Risk: ${label}`} title={`Risk: ${label}`}>
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

  const selectedVersion = useMemo(() => {
    if (!selectedLibrary) return null;
    return selectedLibrary.versions.find(version => version.version === selectedVersionId) ?? null;
  }, [selectedLibrary, selectedVersionId]);

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
                const recentVersions = library.versions.slice(-6);
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
                {selectedLibrary.versions.map(version => {
                  const isSelected = selectedVersionId === version.version;
                  const riskScore = version.risk_score ?? null;
                  const riskLevel = version.risk_level ?? null;
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
                              <RiskGauge score={riskScore} level={riskLevel} compact needleless />
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
                        compact
                        needleless
                      />
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
