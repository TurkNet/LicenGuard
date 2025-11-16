import { useEffect, useState } from 'react';
import { fetchLibraries } from './api/client.js';
import ImportModal from './components/ImportModal.jsx';
import LibrarySummary from './components/LibrarySummary.jsx';
import heroLogo from './assets/logo.png';

export default function App() {
  const [libraries, setLibraries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

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
        <button className="inline-add" onClick={() => setIsModalOpen(true)} aria-label="Add library">
          +
        </button>
      </section>
      <LibrarySummary libraries={filteredLibraries} />

      <ImportModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onImported={loadLibraries} />

      {loading && <p>Loading libraries...</p>}
      {error && <p className="error">{error}</p>}

    </div>
  );
}
