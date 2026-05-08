// Simple wrapper for IndexedDB to handle large video files
const DB_NAME = 'RodeoClipDB';
const STORE_NAME = 'temp_videos';
const VERSION = 1;

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);

    request.onerror = (event) => reject(event);
    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

export const storeFile = async (id: string, file: File): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ id, file, timestamp: Date.now() });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getFile = async (id: string): Promise<File | undefined> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result?.file);
    request.onerror = () => reject(request.error);
  });
};

export const clearStorage = async (): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};