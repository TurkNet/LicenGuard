import { useEffect, useState } from 'react';
import { fetchRepositoryScans } from '../api/client.js';

export default function RepoScans() {
  const [repoScans, setRepoScans] = useState([]);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState(null);
  const [repoQuery, setRepoQuery] = useState('');
  const [formatter] = useState(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: tz
    });
  });

  const loadRepoScans = async (queryText = '') => {
    try {
      setRepoLoading(true);
      const data = await fetchRepositoryScans({ query: queryText || undefined });
      setRepoScans(data || []);
      setRepoError(null);
    } catch (err) {
      setRepoError(err.message);
    } finally {
      setRepoLoading(false);
    }
  };

  useEffect(() => {
    loadRepoScans(repoQuery);
  }, [repoQuery]);

  const handleSearch = (e) => {
    e?.preventDefault();
    loadRepoScans(repoQuery);
  };

  return (
    <section className="panel repo-scans">
      <div className="repo-scans__header">
        <div>
          <h2>Repository Taramaları</h2>
          <p className="muted">
            Repo linki ile yapılan taramaları buradan listeleyip, hangi repoda hangi kütüphane var takip edeceğiz.
            Detaylar geldiğinde bu sayfayı genişleteceğiz.
          </p>
        </div>
      </div>
      <div className="repo-scans__table">
        <form className="repo-scans__search" onSubmit={handleSearch}>
          <input
            type="search"
            placeholder="Repo, platform, dosya yolu veya kütüphane adı/versiyon ara..."
            value={repoQuery}
            onChange={e => setRepoQuery(e.target.value)}
          />
          <button type="submit" disabled={repoLoading}>
            {repoLoading ? 'Aranıyor…' : 'Ara'}
          </button>
        </form>
        {repoLoading && (
          <div className="repo-scans__row repo-scans__row--empty">
            <div className="repo-scans__empty">
              <p>Yükleniyor...</p>
              <p className="muted">Repo kayıtları getiriliyor.</p>
            </div>
          </div>
        )}
        {repoError && (
          <div className="repo-scans__row repo-scans__row--empty">
            <div className="repo-scans__empty">
              <p>Bir hata oluştu.</p>
              <p className="muted">{repoError}</p>
            </div>
          </div>
        )}
        {!repoLoading && !repoError && repoScans.length === 0 && (
          <div className="repo-scans__row repo-scans__row--empty">
            <div className="repo-scans__empty">
              <p>Henüz kayıt yok.</p>
              <p className="muted">İlk repo taraması geldiğinde burada görünecek.</p>
            </div>
          </div>
        )}
        {!repoLoading && !repoError && repoScans.length > 0 && (
          <div className="repo-scans__list">
            {repoScans.map(scan => {
              const deps = scan.dependencies || [];
              const repoLabel = scan.repository_name || scan.repository_url;
              const lastUpdated = scan.updatedAt || scan.updated_at || scan.updated_at; // fallback just in case
              return (
                <div className="repo-scans__group" key={scan._id || scan.id || scan.repository_url}>
                  <div className="repo-scans__repo-heading">
                    <div className="repo-scans__repo-meta">
                      <span className="repo-scans__repo-title">
                        {scan.repository_url ? (
                          <a href={scan.repository_url} target="_blank" rel="noreferrer">{repoLabel}</a>
                        ) : repoLabel}
                      </span>
                      {scan.repository_platform && <span className="repo-scans__platform">{scan.repository_platform}</span>}
                    </div>
                    {lastUpdated && (
                      <span className="repo-scans__date repo-scans__date--right">
                        Son tarama: {formatter.format(new Date(lastUpdated))}
                      </span>
                    )}
                  </div>
                  <div className="repo-scans__deps">
                    {deps.length === 0 && (
                      <div className="repo-scans__row repo-scans__row--empty">
                        <div className="repo-scans__empty">
                          <p>Dependency dosyası bulunamadı.</p>
                        </div>
                      </div>
                    )}
                    {deps.map((dep, idx) => (
                      <div className="repo-scans__dep" key={`${dep.library_path}-${idx}`}>
                        <div className="repo-scans__path">{dep.library_path}</div>
                        <ul className="repo-scans__libs">
                          {(dep.libraries || []).map((lib, lidx) => (
                            <li key={`${dep.library_path}-${lib.library_name}-${lidx}`}>
                              <span className="repo-scans__lib-name">{lib.library_name}</span>
                              <span className="repo-scans__lib-version">versiyon {lib.library_version || 'unknown'}</span>
                            </li>
                          ))}
                          {(dep.libraries || []).length === 0 && (
                            <li className="muted">Kütüphane bulunamadı</li>
                          )}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
