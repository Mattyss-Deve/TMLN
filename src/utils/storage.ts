const DB_NAME = 'chronomap-cache-v1';
const DB_VERSION = 1;
const STORE_NAME = 'timeline_files';
const LATEST_KEY = 'latest';

const STARRED_STORAGE_KEY = 'chronomap.starred.v1';

export interface StoredTimelineRecord {
  file: File;
  fileName: string;
  savedAtMs: number;
  fileSizeBytes: number;
}

interface RawStoredRecord {
  id: string;
  blob: Blob;
  fileName: string;
  savedAtMs: number;
  fileSizeBytes: number;
}

function openCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Persists an imported Google Timeline JSON File/Blob into IndexedDB so reopening
 * ChronoMap restores the user's multi-year timeline automatically without re-importing.
 */
export async function saveTimelineToIndexedDB(
  file: File | Blob,
  fileName: string
): Promise<boolean> {
  const db = await openCacheDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: RawStoredRecord = {
        id: LATEST_KEY,
        blob: file,
        fileName: fileName || 'Timeline.json',
        savedAtMs: Date.now(),
        fileSizeBytes: file.size,
      };
      store.put(record);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
      tx.onabort = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

/**
 * Loads the last imported Google Timeline JSON file from IndexedDB, if present.
 */
export async function loadTimelineFromIndexedDB(): Promise<StoredTimelineRecord | null> {
  const db = await openCacheDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(LATEST_KEY);
      req.onsuccess = () => {
        const raw = req.result as RawStoredRecord | undefined;
        db.close();
        if (!raw || !raw.blob) {
          resolve(null);
          return;
        }
        const restoredFile = new File([raw.blob], raw.fileName || 'Timeline.json', {
          type: raw.blob.type || 'application/json',
          lastModified: raw.savedAtMs || Date.now(),
        });
        resolve({
          file: restoredFile,
          fileName: raw.fileName || 'Timeline.json',
          savedAtMs: raw.savedAtMs || Date.now(),
          fileSizeBytes: raw.fileSizeBytes ?? raw.blob.size,
        });
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/**
 * Clears the cached timeline file from IndexedDB.
 */
export async function clearTimelineFromIndexedDB(): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(LATEST_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

/**
 * Loads bookmarked / starred trip or day IDs from localStorage.
 */
export function loadStarredTripIds(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STARRED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

/**
 * Saves bookmarked / starred trip or day IDs to localStorage.
 */
export function saveStarredTripIds(ids: string[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STARRED_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Pure helper to toggle a trip/day ID in the starred list.
 */
export function toggleStarredTripId(ids: string[], id: string): string[] {
  if (ids.includes(id)) {
    return ids.filter((item) => item !== id);
  }
  return [id, ...ids];
}
