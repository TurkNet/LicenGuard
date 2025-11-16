import { useState } from 'react';

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

function getLicenseGuide(licenseName) {
  if (!licenseName) return null;
  const guideKey = licenseName.toLowerCase();
  return LICENSE_GUIDES[guideKey] ?? null;
}

export default function LibraryCard({ library, onAddVersion }) {
  const libraryId = library.id ?? library._id;
  const [versionForm, setVersionForm] = useState({ version: '', license_name: '', license_url: '' });

  const handleSubmit = async (event) => {
    event.preventDefault();
    await onAddVersion(libraryId, versionForm);
    setVersionForm({ version: '', license_name: '', license_url: '' });
  };

  return (
    <article className="panel">
      <header>
        <h3>{library.name}</h3>
        <p className="eyebrow">{library.ecosystem}</p>
        {library.description && <p>{library.description}</p>}
        {library.repository_url && (
          <a href={library.repository_url} target="_blank" rel="noreferrer">
            Repo ↗
          </a>
        )}
      </header>

      <div>
        <h4>Versions</h4>
        <ul className="versions">
          {library.versions.map((version) => {
            const guide = getLicenseGuide(version.license_name);
            return (
              <li key={`${libraryId}-${version.version}`} className="version-item">
                <div className="version-header">
                  <strong>{version.version}</strong>
                  {guide ? (
                    <span className="license-tag" tabIndex={0}>
                      {version.license_name}
                      <span className="license-tooltip" role="tooltip">
                        <p className="license-guide__title">{guide.title}:</p>
                        <ul>
                          {guide.bullets.map((bullet, index) => (
                            <li key={`${libraryId}-${version.version}-bullet-${index}`}>
                              <span className="license-guide__icon">{bullet.icon}</span>
                              <span>{bullet.text}</span>
                            </li>
                          ))}
                        </ul>
                      </span>
                    </span>
                  ) : (
                    <span>{version.license_name ?? 'Unknown license'}</span>
                  )}
                  {version.license_url && (
                    <a href={version.license_url} target="_blank" rel="noreferrer">
                      License
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          placeholder="Version"
          value={versionForm.version}
          onChange={(e) => setVersionForm((prev) => ({ ...prev, version: e.target.value }))}
          required
        />
        <input
          placeholder="License name"
          value={versionForm.license_name}
          onChange={(e) => setVersionForm((prev) => ({ ...prev, license_name: e.target.value }))}
        />
        <input
          placeholder="License URL"
          value={versionForm.license_url}
          onChange={(e) => setVersionForm((prev) => ({ ...prev, license_url: e.target.value }))}
        />
        <button type="submit">Add version</button>
      </form>
    </article>
  );
}
