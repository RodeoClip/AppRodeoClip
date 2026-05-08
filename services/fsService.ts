import { saveAs } from 'file-saver';
const DB_NAME = 'RodeoClipFS';
const STORE_NAME = 'dir';

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

const setDirHandle = async (handle: FileSystemDirectoryHandle): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put({ id: 'download', handle, ts: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const getDirHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get('download');
    req.onsuccess = () => resolve(req.result?.handle || null);
    req.onerror = () => reject(req.error);
  });
};

const ensurePermission = async (handle: FileSystemDirectoryHandle): Promise<boolean> => {
  const h: any = handle as any;
  if (typeof h.queryPermission === 'function') {
    const q = await h.queryPermission({ mode: 'readwrite' });
    if (q === 'granted') return true;
  }
  if (typeof h.requestPermission === 'function') {
    const r = await h.requestPermission({ mode: 'readwrite' });
    if (r === 'granted') return true;
  }
  try {
    const test = await handle.getFileHandle('__perm_test__', { create: true });
    const w = await test.createWritable();
    await w.write(new Blob(['ok']));
    await w.close();
    try { await handle.removeEntry('__perm_test__'); } catch {}
    return true;
  } catch {
    return false;
  }
};

const sanitize = (name: string): string => {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
};

const pickDirectory = async (): Promise<FileSystemDirectoryHandle> => {
  // @ts-ignore
  const handle = await window.showDirectoryPicker();
  await setDirHandle(handle);
  return handle;
};

const ensureDownloadDirectory = async (forcePick?: boolean): Promise<FileSystemDirectoryHandle | null> => {
  // @ts-ignore
  if (!window.showDirectoryPicker) return null;
  if (!forcePick) {
    let handle = await getDirHandle();
    if (handle) {
      const ok = await ensurePermission(handle);
      if (ok) return handle;
    }
  }
  let handle: FileSystemDirectoryHandle | null = null;
  try {
    handle = await pickDirectory();
  } catch (e) {
    return null;
  }
  const ok2 = handle ? await ensurePermission(handle) : false;
  return ok2 ? handle : null;
};

const writeFileFromUrl = async (url: string, filename: string, dirHandle?: FileSystemDirectoryHandle | null): Promise<void> => {
  const name = sanitize(filename);
  if (dirHandle) {
    try {
      const ok = await ensurePermission(dirHandle);
      if (!ok) throw new Error('permission_denied');
      const fileHandle = await dirHandle.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download_http_${res.status}`);
      const blob = await res.blob();
      if (!blob || blob.size === 0) throw new Error('download_blob_empty');
      await writable.write(blob);
      await writable.close();
      try {
        const saved = await fileHandle.getFile();
        if (!saved || saved.size === 0) {
          const writable2 = await fileHandle.createWritable();
          await writable2.write(blob);
          await writable2.close();
          const saved2 = await fileHandle.getFile();
          if (!saved2 || saved2.size === 0) throw new Error('zero_byte_write_detected_retry_failed');
        }
      } catch (verr) {
        throw verr;
      }
      return;
    } catch (err) {
      console.error('FileSystem API write-from-url failed, falling back to browser download', err);
    }
  }
  if ((window as any).showSaveFilePicker) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download_http_${res.status}`);
      const blob = await res.blob();
      if (!blob || blob.size === 0) throw new Error('download_blob_empty');
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Video MP4', accept: { 'video/mp4': ['.mp4'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if ((e as any)?.name !== 'AbortError') {
        console.error('SaveFilePicker write-from-url failed, falling back to saveAs', e);
      }
    }
  }
  {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download_http_${res.status}`);
    const blob = await res.blob();
    if (!blob || blob.size === 0) throw new Error('download_blob_empty');
    saveAs(blob, name);
  }
};

const writeFileFromBlob = async (blob: Blob, filename: string, dirHandle?: FileSystemDirectoryHandle | null): Promise<void> => {
  if (!blob || blob.size === 0) {
    throw new Error('blob_is_empty_cannot_save');
  }
  const name = sanitize(filename);
  if (dirHandle) {
    try {
      const ok = await ensurePermission(dirHandle);
      if (!ok) throw new Error('permission_denied');
      const fileHandle = await dirHandle.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      
      // Verify write success with a short delay to allow file system flush
      await new Promise(resolve => setTimeout(resolve, 200));
      try {
         const saved = await fileHandle.getFile();
         if (!saved || saved.size === 0) {
             // Try one more time to write if zero bytes
             const writable2 = await fileHandle.createWritable();
             await writable2.write(blob);
             await writable2.close();
             const saved2 = await fileHandle.getFile();
             if (!saved2 || saved2.size === 0) throw new Error('zero_byte_write_detected_retry_failed');
         }
      } catch (verr) {
         throw verr;
      }
      return;
    } catch (err) {
      console.error('FileSystem API write failed, falling back to saveAs', err);
      // Fallback to native browser download if filesystem write fails
      saveAs(blob, name);
      return;
    }
  }
  if ((window as any).showSaveFilePicker) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Video MP4', accept: { 'video/mp4': ['.mp4'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
       if ((e as any).name !== 'AbortError') {
          saveAs(blob, name);
       }
       return;
    }
  }
  saveAs(blob, name);
};

const filenameFromUrl = (url: string): string => {
  const u = new URL(url);
  const last = u.pathname.split('/').pop() || 'video.mp4';
  return last;
};

export const fsService = {
  ensureDownloadDirectory,
  writeFileFromUrl,
  writeFileFromBlob,
  filenameFromUrl,
  saveStandard: (blob: Blob, filename: string) => {
    saveAs(blob, sanitize(filename));
  },
  writeBlobToHandle: async (handle: FileSystemFileHandle, blob: Blob): Promise<void> => {
    if (!blob || blob.size === 0) throw new Error('blob_is_empty');
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    
    // Verify write
    const saved = await handle.getFile();
    if (!saved || saved.size === 0) throw new Error('write_failed_zero_bytes');
  },
  getOrCreateSubdirectory: async (dirHandle: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle> => {
    const sub = await dirHandle.getDirectoryHandle(name, { create: true });
    return sub;
  },
  rememberDownloadDirectory: async (handle: FileSystemDirectoryHandle): Promise<boolean> => {
    const ok = await ensurePermission(handle);
    if (!ok) return false;
    await setDirHandle(handle);
    return true;
  },
};
