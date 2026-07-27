import type {
  ClearDataResponse,
  ImportSessionListResponse,
  IngestResponse,
  QueryRequest,
  QueryResponse,
  SchemaResponse,
} from './types';

const RAW_API_BASE = import.meta.env.PUBLIC_API_BASE ?? 'http://localhost:8000';

function resolveApiBase(): string {
  // Docker service hostnames (e.g. "backend") are not resolvable from the user's browser.
  if (typeof window === 'undefined') {
    return RAW_API_BASE;
  }

  try {
    const parsed = new URL(RAW_API_BASE);
    if (parsed.hostname !== 'backend') {
      return RAW_API_BASE;
    }

    return `${window.location.protocol}//${window.location.hostname}:8000`;
  } catch {
    return RAW_API_BASE;
  }
}

const API_BASE = resolveApiBase();

export async function uploadFile(
  file: File,
  onProgress?: (percent: number, loadedBytes: number, totalBytes: number) => void,
): Promise<IngestResponse> {
  const formData = new FormData();
  formData.append('file', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/ingest`);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) {
        return;
      }
      const percent = Math.round((event.loaded / event.total) * 100);
      onProgress(percent, event.loaded, event.total);
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Ingest failed with status ${xhr.status}`));
        return;
      }

      try {
        const payload = JSON.parse(xhr.responseText) as IngestResponse;
        resolve(payload);
      } catch {
        reject(new Error('Ingest response was not valid JSON'));
      }
    };

    xhr.onerror = () => {
      reject(new Error(`Upload failed because of a network error (API: ${API_BASE})`));
    };

    xhr.send(formData);
  });
}

export async function runTransform(fileId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/transform/${fileId}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Transform failed: ${detail}`);
  }
}

export async function fetchSchema(fileId: string): Promise<SchemaResponse> {
  const response = await fetch(`${API_BASE}/schema/${fileId}`);
  if (!response.ok) {
    throw new Error(`Schema request failed with status ${response.status}`);
  }
  return response.json();
}

export async function fetchSessions(limit = 100): Promise<ImportSessionListResponse> {
  const response = await fetch(`${API_BASE}/ingest/sessions?limit=${encodeURIComponent(String(limit))}`);
  if (!response.ok) {
    throw new Error(`Session request failed with status ${response.status}`);
  }
  return response.json();
}

export async function clearServerData(): Promise<ClearDataResponse> {
  const response = await fetch(`${API_BASE}/ingest/data`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Clear data failed: ${detail}`);
  }

  return response.json();
}

export async function runQuery(request: QueryRequest): Promise<QueryResponse> {
  const response = await fetch(`${API_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Query failed: ${detail}`);
  }
  return response.json();
}
