import { useEffect, useMemo, useState } from 'react';

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

  if (!libraries.length) {
    return null;
  }

  return (
    <div className="panel summary-panel master-detail-shell">
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
      >
        <section className="master-panel panel">
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
                      {(library.official_site || library.officialSite) && (
                        <div className="summary-row__field">
                          <span className="summary-row__label">Official site :</span>
                          <span className="summary-row__value summary-row__value--link">
                            <a
                              href={library.official_site ?? library.officialSite}
                              target="_blank"
                              rel="noreferrer"
                              className="summary-row__link summary-row__link--prominent"
                            >
                              {library.official_site ?? library.officialSite}
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
        </section>

        <section className="panel version-panel version-panel--list">
          {selectedLibrary ? (
            <>
              <div className="detail-header">
                <button type="button" className="ghost-button" onClick={() => setSelectedLibraryId(null)}>
                  ← Listeye dön
                </button>
                <div>
                  <h3>{selectedLibrary.name}</h3>
                  <p className="eyebrow">{selectedLibrary.ecosystem}</p>
                </div>
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
            </>
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
