import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const apiBase = process.env.API_URL ?? 'http://localhost:4000';
const appUrl = typeof window !== 'undefined' ? window.location.origin : 'unknown';
console.info(`[LicenGuard Web] starting at ${appUrl} (API: ${apiBase})`);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
