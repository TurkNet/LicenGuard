const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

const jsonHeaders = {
  'Content-Type': 'application/json'
};

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...jsonHeaders, ...(options.headers ?? {}) }
  });

  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Request failed with status ${res.status}`);
  }

  return res.json();
}

export function fetchLibraries(limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request(`/libraries?${params.toString()}`);
}

export function searchLibraries(query) {
  const params = new URLSearchParams({ q: query });
  return request(`/libraries/search?${params.toString()}`);
}

export function createLibrary(payload) {
  return request('/libraries', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function addVersion(libraryId, payload) {
  return request(`/libraries/${libraryId}/versions`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function cloneRepository(url) {
  const res = await fetch(`${API_BASE}/libraries/repositories/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export async function listRepositoryPackages({ root, url } = {}) {
  const body = JSON.stringify(root ? { root } : { url });
  const res = await fetch(`${API_BASE}/libraries/repositories/list-packages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  return res.json();
}

// Backwards-compatible scanRepository: accepts string url or object { url } | { root }
export async function scanRepository(input) {
  let body;
  if (typeof input === 'string') body = JSON.stringify({ url: input });
  else body = JSON.stringify(input || {});
  const res = await fetch(`${API_BASE}/libraries/repositories/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export async function analyzeFileUpload(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/libraries/analyze/file`, {
    method: 'POST',
    body: form
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function fetchRepositoryScans({ limit = 100, query } = {}) {
  const params = new URLSearchParams();
  if (limit) params.append('limit', String(limit));
  if (query) params.append('q', query);
  const searchPath = query ? '/repository-scans/search' : '/repository-scans';
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request(`${searchPath}${suffix}`);
}
