import React, { useCallback, useRef, useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { VideoFile } from '../types';
import { storeFile } from '../services/storageService';
import { MAX_FILE_SIZE } from '../constants';
import { logger } from '../services/loggingService';
import { FolderUp, FileVideo, Loader2, AlertCircle, Trash2, Film } from 'lucide-react';
import { blobManager } from '../services/blobManager';

const MAX_VIDEOS_PER_BATCH = 10;

/** Extrai um frame do vídeo como data-URL para thumbnail */
async function extractThumbnail(file: File, blobUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const timeout = setTimeout(() => { cleanup(); resolve(null); }, 5000);

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      video.src = '';
    };

    const onSeeked = () => {
      try {
        canvas.width  = 80;
        canvas.height = 80;
        const ctx = canvas.getContext('2d')!;
        // crop center square
        const vw = video.videoWidth, vh = video.videoHeight;
        const side = Math.min(vw, vh);
        const sx = (vw - side) / 2, sy = (vh - side) / 2;
        ctx.drawImage(video, sx, sy, side, side, 0, 0, 80, 80);
        cleanup();
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        cleanup();
        resolve(null);
      }
    };
    const onError = () => { cleanup(); resolve(null); };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.preload = 'metadata';
    video.muted   = true;
    video.src     = blobUrl;
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(1, video.duration * 0.1);
    }, { once: true });
  });
}

/* ── Thumbnail component ── */
const Thumb: React.FC<{ file: VideoFile; active: boolean; onSelect: () => void; onRemove: () => void }> = ({
  file, active, onSelect, onRemove
}) => {
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    if (!file.previewUrl) { setThumb(null); return; }
    let alive = true;
    extractThumbnail(file.file, file.previewUrl).then(t => {
      if (alive) setThumb(t);
    });
    return () => { alive = false; };
  }, [file.id, file.previewUrl]);

  return (
    <div
      className={`thumb-item fade-in ${active ? 'active' : ''}`}
      onClick={onSelect}
    >
      {/* thumbnail */}
      {thumb
        ? <img src={thumb} alt="" className="w-11 h-11 object-cover rounded flex-shrink-0" draggable={false} />
        : (
          <div className="thumb-no-preview">
            <Film className="w-5 h-5" />
          </div>
        )
      }

      {/* name + size */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-200 truncate font-medium">{file.file.name}</p>
        <p className="text-xs text-gray-500 mt-0.5">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
      </div>

      {/* remove */}
      <button
        className="flex-shrink-0 text-gray-600 hover:text-red-400 transition-colors p-1"
        onClick={e => { e.stopPropagation(); onRemove(); }}
        title="Remover"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};

/* ── Main UploadZone ── */
export const UploadZone: React.FC = () => {
  const { state, dispatch } = useApp();
  const { files, activeFileId } = state;

  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragOver,  setDragOver]  = useState(false);
  const [indexing,  setIndexing]  = useState({ active: false, label: '' });
  const [limitWarn, setLimitWarn] = useState<string | null>(null);

  const isAllowedVideo = (file: File) => {
    if (file.type?.startsWith('video/')) return true;
    const ext = (file.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
    return ['.mp4','.mov','.mxf','.m4v','.avi','.webm','.mkv'].includes(ext);
  };

  const canPreviewInBrowser = (file: File) => {
    try {
      const v = document.createElement('video');
      const ext = (file.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
      const types: string[] = [];
      if (file.type) types.push(file.type);
      if (['.mp4','.m4v'].includes(ext)) types.push('video/mp4');
      if (ext === '.webm') types.push('video/webm');
      if (ext === '.mov')  types.push('video/quicktime');
      if (ext === '.avi')  types.push('video/x-msvideo');
      return types.some(t => v.canPlayType(t) !== '');
    } catch { return false; }
  };

  const processPickedFiles = async (
    picked: Array<{ file: File; relativePath: string }>,
    onProgress?: (n: number, total: number) => void
  ) => {
    if (!picked.length) return;
    setLimitWarn(null);

    const sorted = [...picked].sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath, 'pt-BR', { numeric: true, sensitivity: 'base' })
    );
    const videos = sorted.filter(({ file }) => file.size <= MAX_FILE_SIZE && isAllowedVideo(file));
    let list = videos;

    if (videos.length > MAX_VIDEOS_PER_BATCH) {
      list = videos.slice(0, MAX_VIDEOS_PER_BATCH);
      const extra = videos.length - MAX_VIDEOS_PER_BATCH;
      setLimitWarn(`Limite de ${MAX_VIDEOS_PER_BATCH} vídeos atingido. ${extra} vídeo${extra > 1 ? 's' : ''} ignorado${extra > 1 ? 's' : ''}.`);
    }

    logger.log('upload_attempt', { count: list.length });
    const validFiles: VideoFile[] = [];

    for (let i = 0; i < list.length; i++) {
      if (i % 5 === 0) await new Promise<void>(r => setTimeout(r, 0));
      onProgress?.(i + 1, list.length);
      const { file, relativePath } = list[i];
      const id = crypto.randomUUID();
      storeFile(id, file).catch(() => {});
      const previewUrl = canPreviewInBrowser(file) ? blobManager.create(id, file) : null;
      validFiles.push({ id, file, previewUrl, relativePath, duration: 0, format: file.type || 'video/*', size: file.size });
    }

    if (validFiles.length > 0) {
      dispatch({ type: 'SET_FILES', payload: validFiles });
      dispatch({ type: 'UPDATE_SETTINGS', payload: { rotation: 90 } });
      logger.log('upload_success', { count: validFiles.length });
    }
  };

  const collectDir = async (
    handle: any, prefix = '', onFile?: (p: string) => void
  ): Promise<Array<{ file: File; relativePath: string }>> => {
    const out: Array<{ file: File; relativePath: string }> = [];
    for await (const [, entry] of handle.entries()) {
      try {
        if (entry.kind === 'file') {
          const f = await entry.getFile();
          const rp = `${prefix}${entry.name}`;
          out.push({ file: f, relativePath: rp });
          onFile?.(rp);
        } else if (entry.kind === 'directory') {
          out.push(...await collectDir(entry, `${prefix}${entry.name}/`, onFile));
        }
      } catch {}
    }
    return out;
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (indexing.active) return;
    (async () => {
      const items = e.dataTransfer?.items;
      if (!items?.length) return;
      const picked: Array<{ file: File; relativePath: string }> = [];
      let discovered = 0;
      setIndexing({ active: true, label: 'Analisando…' });

      for (const it of Array.from(items)) {
        const hg = (it as any).getAsFileSystemHandle;
        if (typeof hg === 'function') {
          try {
            const h = await hg.call(it);
            if (h?.kind === 'directory') {
              const nested = await collectDir(h, `${h.name}/`, () => {
                discovered++;
                setIndexing({ active: true, label: `Indexando (${discovered})` });
              });
              picked.push(...nested);
            } else if (h?.kind === 'file') {
              picked.push({ file: await h.getFile(), relativePath: (await h.getFile()).name });
            }
          } catch {}
          continue;
        }
        const entry = (it as any).webkitGetAsEntry?.();
        if (!entry) {
          const f = it.getAsFile?.();
          if (f) picked.push({ file: f, relativePath: f.name });
          continue;
        }
        const walk = async (ent: any, prefix: string): Promise<void> => {
          if (ent.isFile) {
            try {
              const f: File = await new Promise((res, rej) => ent.file(res, rej));
              discovered++;
              setIndexing({ active: true, label: `Indexando (${discovered})` });
              picked.push({ file: f, relativePath: `${prefix}${f.name}` });
            } catch {}
          } else if (ent.isDirectory) {
            const reader = ent.createReader();
            const batch = (): Promise<any[]> => new Promise((res, rej) => reader.readEntries(res, rej));
            while (true) {
              const entries = await batch();
              if (!entries.length) break;
              for (const child of entries) await walk(child, `${prefix}${ent.name}/`);
            }
          }
        };
        await walk(entry, '');
      }

      setIndexing({ active: true, label: `Carregando (0/${picked.length})` });
      await processPickedFiles(picked, (n, total) =>
        setIndexing({ active: true, label: `Carregando (${n}/${total})` })
      );
      setIndexing({ active: false, label: '' });
    })();
  }, [indexing.active]);

  const handleSelectFolder = async () => {
    if (indexing.active) return;
    if (!(window as any).showDirectoryPicker) { folderInputRef.current?.click(); return; }
    try {
      setIndexing({ active: true, label: 'Indexando pasta…' });
      const handle = await (window as any).showDirectoryPicker();
      let n = 0;
      const files = await collectDir(handle, `${handle.name}/`, () => {
        n++;
        setIndexing({ active: true, label: `Indexando (${n})` });
      });
      setIndexing({ active: true, label: `Carregando (0/${files.length})` });
      await processPickedFiles(files, (k, total) =>
        setIndexing({ active: true, label: `Carregando (${k}/${total})` })
      );
    } catch (err: any) {
      if (err?.name !== 'AbortError')
        alert('Não foi possível acessar a pasta. Verifique as permissões.');
    } finally {
      setIndexing({ active: false, label: '' });
    }
  };

  const hasFiles = files.length > 0;

  return (
    <div className="flex flex-col gap-3">

      {/* ── Drop zone ── */}
      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        className={`border-2 border-dashed rounded-xl p-5 text-center transition-all cursor-default ${
          dragOver
            ? 'border-amber-500 bg-amber-900/10'
            : 'border-amber-600/40 bg-amber-950/10 hover:border-amber-500/70 hover:bg-amber-900/5'
        }`}
      >
        <p className="text-white font-bold text-base mb-0.5">Insira seus vídeos</p>
        <p className="text-gray-500 text-xs mb-1">MP4, MOV, MXF, AVI, WebM, MKV · máx. 5 GB/arquivo</p>
        <p className="text-amber-400 text-xs font-semibold mb-4">Máximo {MAX_VIDEOS_PER_BATCH} vídeos por lote</p>

        <div className="flex gap-2">
          <button
            onClick={handleSelectFolder}
            disabled={indexing.active}
            className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-lg font-bold text-sm text-white
              bg-slate-700 border-b-[3px] border-slate-900 transition-all
              ${indexing.active ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-600 active:border-b-0 active:translate-y-0.5'}`}
          >
            <FolderUp className="w-6 h-6" />
            Pasta
          </button>
          <label
            className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-lg font-bold text-sm
              bg-emerald-900/60 border-b-[3px] border-emerald-950 text-emerald-300 transition-all cursor-pointer
              ${indexing.active ? 'opacity-50 pointer-events-none' : 'hover:bg-emerald-800/60 active:border-b-0 active:translate-y-0.5'}`}
          >
            <FileVideo className="w-6 h-6" />
            Arquivos
            <input
              type="file" multiple className="hidden"
              accept="video/mp4,video/quicktime,video/x-m4v,video/avi,video/webm,video/x-matroska,.mp4,.mov,.mxf,.m4v,.avi,.webm,.mkv"
              onChange={async e => {
                if (indexing.active) return;
                /* copiar array antes de resetar o input */
                const picked = Array.from(e.target.files ?? []).map(f => ({ file: f, relativePath: f.name }));
                e.target.value = '';
                if (picked.length === 0) return;
                setIndexing({ active: true, label: `Carregando (0/${picked.length})` });
                await processPickedFiles(picked, (n, total) =>
                  setIndexing({ active: true, label: `Carregando (${n}/${total})` })
                );
                setIndexing({ active: false, label: '' });
              }}
            />
          </label>
        </div>

        {indexing.active && (
          <div className="mt-3 flex items-center justify-center gap-2 text-xs text-gray-300">
            <Loader2 className="w-3.5 h-3.5 spin text-amber-400" />
            {indexing.label}
          </div>
        )}

        {limitWarn && !indexing.active && (
          <div className="mt-3 flex items-start gap-2 bg-yellow-900/25 border border-yellow-700/40 rounded-lg px-3 py-2 text-xs text-yellow-300 text-left">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            {limitWarn}
          </div>
        )}

        {!indexing.active && !hasFiles && (
          <p className="text-gray-700 text-xs mt-3">ou arraste arquivos/pastas aqui</p>
        )}
      </div>

      {/* ── Thumbnail list ── */}
      {hasFiles && (
        <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
          <div className="flex items-center justify-between mb-1 px-1">
            <span className="text-xs text-amber-400 font-semibold">{files.length} vídeo{files.length !== 1 ? 's' : ''}</span>
            <button
              onClick={() => {
                files.forEach(f => { blobManager.revoke(f.id); blobManager.revoke(`compat:${f.id}`); });
                dispatch({ type: 'SET_FILES', payload: [] });
                setLimitWarn(null);
              }}
              className="text-xs text-gray-600 hover:text-red-400 transition-colors"
            >
              Limpar todos
            </button>
          </div>
          {files.map(f => (
            <Thumb
              key={f.id}
              file={f}
              active={f.id === activeFileId}
              onSelect={() => dispatch({ type: 'SET_ACTIVE_FILE', payload: f.id })}
              onRemove={() => dispatch({ type: 'REMOVE_FILE', payload: f.id })}
            />
          ))}
        </div>
      )}

      {/* hidden inputs */}
      <input ref={folderInputRef} type="file"
        // @ts-ignore
        webkitdirectory="" directory="" multiple className="hidden"
        onChange={async e => {
          if (indexing.active) { e.target.value = ''; return; }
          const picked = Array.from(e.target.files ?? []).map(f => ({
            file: f as File,
            relativePath: String((f as any).webkitRelativePath || f.name)
          }));
          e.target.value = '';
          if (!picked.length) return;
          setIndexing({ active: true, label: `Carregando (0/${picked.length})` });
          await processPickedFiles(picked, (n, total) =>
            setIndexing({ active: true, label: `Carregando (${n}/${total})` })
          );
          setIndexing({ active: false, label: '' });
        }}
      />
    </div>
  );
};
