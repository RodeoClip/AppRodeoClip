import React from 'react';

class GlobalBlobManager {
  private static instance: GlobalBlobManager;
  private blobs: Map<string, { url: string; file: File | Blob; timestamp: number }> = new Map();

  private constructor() {}

  static getInstance(): GlobalBlobManager {
    if (!GlobalBlobManager.instance) {
      GlobalBlobManager.instance = new GlobalBlobManager();
    }
    return GlobalBlobManager.instance;
  }

  create(id: string, file: File | Blob): string {
    if (this.blobs.has(id)) {
      const old = this.blobs.get(id)!;
      try { URL.revokeObjectURL(old.url); } catch {}
    }
    const url = URL.createObjectURL(file);
    this.blobs.set(id, { url, file, timestamp: Date.now() });
    return url;
  }

  get(id: string): string | null {
    const blob = this.blobs.get(id);
    return blob ? blob.url : null;
  }

  has(id: string): boolean {
    return this.blobs.has(id);
  }

  revoke(id: string): void {
    const blob = this.blobs.get(id);
    if (blob) {
      try { URL.revokeObjectURL(blob.url); } catch {}
      this.blobs.delete(id);
    }
  }

  revokeAll(): void {
    this.blobs.forEach(({ url }) => {
      try { URL.revokeObjectURL(url); } catch {}
    });
    this.blobs.clear();
  }

  list(): Array<{ id: string; url: string; timestamp: number }> {
    return Array.from(this.blobs.entries()).map(([id, { url, timestamp }]) => ({ id, url, timestamp }));
  }

  cleanup(maxAge: number = 3600000): void {
    const now = Date.now();
    this.blobs.forEach((blob, id) => {
      if (now - blob.timestamp > maxAge) {
        try { URL.revokeObjectURL(blob.url); } catch {}
        this.blobs.delete(id);
      }
    });
  }
}

export const blobManager = GlobalBlobManager.getInstance();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    try { blobManager.revokeAll(); } catch {}
  });
  setInterval(() => { try { blobManager.cleanup(); } catch {} }, 300000);
}

export function useBlobUrl(id: string, file: File | null): string | null {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!file) { setBlobUrl(null); return; }
    let url = blobManager.get(id);
    if (!url) { url = blobManager.create(id, file); }
    setBlobUrl(url);
    return () => {};
  }, [id, file]);
  return blobUrl;
}

export async function validateBlobUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const timeout = setTimeout(() => { cleanup(); resolve(false); }, 3000);
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadstart', onSuccess);
      video.removeEventListener('error', onError);
      video.src = '';
    };
    const onSuccess = () => { cleanup(); resolve(true); };
    const onError = () => { cleanup(); resolve(false); };
    video.addEventListener('loadstart', onSuccess);
    video.addEventListener('error', onError);
    video.preload = 'none';
    video.src = url;
  });
}

export async function createTemporaryBlob<T>(file: File | Blob, callback: (url: string) => Promise<T>): Promise<T> {
  const url = URL.createObjectURL(file);
  try { return await callback(url); } finally { try { URL.revokeObjectURL(url); } catch {} }
}
