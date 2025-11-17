import { useEffect, useState, useRef } from 'react';
import { fetchLibraries } from './api/client.js';
import ImportModal from './components/ImportModal.jsx';
import UploadModal from './components/UploadModal.jsx';
import LibrarySummary from './components/LibrarySummary.jsx';
import heroLogo from './assets/logo.png';

export default function App() {
  const [libraries, setLibraries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isRepoModalOpen, setIsRepoModalOpen] = useState(false);
  const menuRef = useRef(null);

  const loadLibraries = async () => {
    try {
      setLoading(true);
      const data = await fetchLibraries();
      setLibraries(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLibraries();
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  const filteredLibraries = libraries.filter(library => {
    if (!query) return true;
    const lower = query.toLowerCase();
    const nameMatch = library.name.toLowerCase().includes(lower);
    const versionMatch = library.versions.some(version => {
      const versionLower = version.version.toLowerCase();
      return versionLower.includes(lower) || lower.includes(versionLower);
    });
    return nameMatch || versionMatch;
  });

  const closeMenus = () => setIsMenuOpen(false);

  return (
    <div className="app-shell">
      <header className="hero">
        <a href="/" className="hero-logo-link">
          <img src={heroLogo} alt="LicenGuard" className="hero-logo" />
        </a>
        <div>
          <h1>LicenGuard</h1>
          <p>License Intelligence Platform</p>
        </div>
      </header>

      <section className="search-row">
        <div className="search-bar">
          <input
            type="search"
            placeholder="Search libraries or versions..."
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
        <div className="inline-add-wrapper" ref={menuRef}>
          <button
            className="inline-add"
            onClick={() => setIsMenuOpen(prev => !prev)}
            aria-label="Add library"
            type="button"
          >
            +
          </button>
          {isMenuOpen && (
            <div className="inline-menu">
              <button
                type="button"
                className="inline-menu__item"
                onClick={() => {
                  setIsImportModalOpen(true);
                  closeMenus();
                }}
              >
                Elle Ekle
              </button>
              <button
                type="button"
                className="inline-menu__item"
                onClick={() => {
                  setIsUploadModalOpen(true);
                  closeMenus();
                }}
              >
                Dosya Yükle
              </button>
              <button
                type="button"
                className="inline-menu__item"
                onClick={() => {
                  setIsRepoModalOpen(true);
                  closeMenus();
                }}
              >
                Repo Linki
              </button>
            </div>
          )}
        </div>
      </section>
      <LibrarySummary libraries={filteredLibraries} />

      <ImportModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} onImported={loadLibraries} />
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false);
          loadLibraries();
        }}
        onImported={loadLibraries}
      />
      {isRepoModalOpen && (
        <div className="modal-overlay" onClick={() => setIsRepoModalOpen(false)}>
          <div className="modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Repo Linki</h2>
              <button className="close" onClick={() => setIsRepoModalOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="panel" style={{ background: 'transparent', boxShadow: 'none', color: 'white' }}>
              <p>Burada repo linkiyle import akışını ekleyeceğiz.</p>
            </div>
          </div>
        </div>
      )}

      {loading && <p>Loading libraries...</p>}
      {error && <p className="error">{error}</p>}

    </div>
  );
}
