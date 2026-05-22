import { ConversionSettings } from '../types';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { createTemporaryBlob } from './blobManager';

const BASE = location.origin;

let ffmpeg: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

/* fila serial — garante que apenas uma operação FFmpeg roda por vez */
let ffmpegQueue: Promise<any> = Promise.resolve();
const withFFmpegQueue = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = ffmpegQueue.then(() => fn());
  ffmpegQueue = next.catch(() => {});
  return next;
};

const withTimeout = <T>(p: Promise<T>, ms: number) => {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ffmpeg_load_timeout')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }).catch(e => { clearTimeout(t); reject(e); });
  });
};

const loadFFmpeg = async (onProgress?: (p: number) => void) => {
  if (ffmpeg) return ffmpeg;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  const instance = new FFmpeg();
  const tryLoadMT = async (base: string) => {
    const coreURL   = await withTimeout(toBlobURL(`${base}/ffmpeg-core.js`,     'text/javascript'), 30000);
    const wasmURL   = await withTimeout(toBlobURL(`${base}/ffmpeg-core.wasm`,   'application/wasm'), 30000);
    const workerURL = await withTimeout(toBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript'), 30000);
    await withTimeout(instance.load({ coreURL, wasmURL, workerURL }), 60000);
    try { instance.on('log', ({ message }) => console.debug('[ffmpeg]', message)); } catch {}
    try { instance.on('progress', (e: any) => { if (onProgress && typeof e?.progress === 'number') onProgress(Math.round(e.progress * 100)); }); } catch {}
    return instance;
  };

  ffmpegLoadPromise = (async () => {
    let lastErr: any;
    const hasSAB = typeof SharedArrayBuffer !== 'undefined';
    console.log('[ffmpeg] SharedArrayBuffer available:', hasSAB);

    const bases = [
      `${BASE}/ffmpeg-mt`,
      `${BASE}/ffmpeg`,
      'https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/umd',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/umd',
    ];

    for (const base of bases) {
      try {
        console.log('[ffmpeg] trying:', base);
        const result = await tryLoadMT(base);
        console.log('[ffmpeg] loaded from:', base);
        return result;
      } catch (e) {
        console.warn('[ffmpeg] failed:', base, e);
        lastErr = e;
      }
    }

    console.error('[ffmpeg] all bases failed:', lastErr);
    throw lastErr;
  })();

  try {
    ffmpeg = await ffmpegLoadPromise;
    return ffmpeg;
  } catch (e) {
    ffmpeg = null;
    ffmpegLoadPromise = null;
    throw e;
  } finally {
    if (ffmpeg) ffmpegLoadPromise = null;
  }
};

const buildSpeedFilters = (speed: number): { videoPts: string; atempo?: string; speed: number } => {
  const s = Math.max(0.1, Math.min(2.0, speed || 1.0));
  const videoPts = `${(1 / s).toFixed(6)}*PTS`;
  // Build atempo chain within [0.5, 2.0] by splitting factors
  const chains: string[] = [];
  let remaining = s;
  while (remaining < 0.5) { chains.push('0.5'); remaining *= 2; }
  while (remaining > 2.0) { chains.push('2.0'); remaining /= 2; }
  chains.push(remaining.toFixed(2));
  const atempo = chains.map(v => `atempo=${v}`).join(',');
  return { videoPts, atempo, speed: s };
};

const parseRotationFromLogs = (message: string): number | null => {
  if (!message) return null;
  const m1 = message.match(/rotate\s*:\s*(-?\d+(?:\.\d+)?)/i);
  const m2 = message.match(/rotation of\s*(-?\d+(?:\.\d+)?)\s*degrees/i);
  const raw = m1?.[1] ?? m2?.[1];
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  let deg = Math.round(n);
  deg = ((deg % 360) + 360) % 360;
  if (deg === 360) deg = 0;
  const snapped = Math.round(deg / 90) * 90;
  const normalized = ((snapped % 360) + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return null;
};

const detectRotationMetadata = async (ff: FFmpeg, inputName: string): Promise<number | null> => {
  const logs: string[] = [];
  const onLog = ({ message }: any) => {
    if (typeof message === 'string') logs.push(message);
  };
  try { ff.on('log', onLog); } catch {}
  try {
    await ff.exec(['-hide_banner', '-i', inputName, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-']);
  } catch {}
  try {
    const off = (ff as any).off;
    if (typeof off === 'function') off.call(ff, 'log', onLog);
  } catch {}
  for (const line of logs) {
    const r = parseRotationFromLogs(line);
    if (r !== null) return r;
  }
  return null;
};

const rotationCorrectionFilter = (rotation: number | null): string => {
  if (rotation === 90) return 'transpose=1,';
  if (rotation === 180) return 'hflip,vflip,';
  if (rotation === 270) return 'transpose=2,';
  return '';
};

export const videoProcessingService = {
  preload: async (): Promise<void> => {
    try { await loadFFmpeg(); } catch {}
  },
  getVideoDimensions: async (file: File): Promise<{ width: number; height: number }> => {
    return createTemporaryBlob(file, async (url) => {
      return new Promise((resolve) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => {
          const res = { width: v.videoWidth || 0, height: v.videoHeight || 0 };
          v.src = '';
          resolve(res);
        };
        v.onerror = () => {
          v.src = '';
          resolve({ width: 0, height: 0 });
        };
        v.src = url;
      });
    });
  },
  transcodeForPreview: (file: File): Promise<Blob> => withFFmpegQueue(async () => {
    if (!file || file.size === 0) {
      throw new Error('input_file_empty');
    }
    const ff = await loadFFmpeg();
    const inputExt = file.name.match(/\.[^.]+$/)?.[0] || '.mp4';
    const uid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(16).slice(2);
    const inputName = `p_in_${uid}${inputExt}`;
    const outputName = `p_out_${uid}.mp4`;

    try { await ff.deleteFile(inputName); } catch {}
    try { await ff.deleteFile(outputName); } catch {}

    await ff.writeFile(inputName, await fetchFile(file));

    try {
      /* detect metadata rotation and video dimensions */
      const metaRotation = await detectRotationMetadata(ff, inputName);
      const dims = await videoProcessingService.getVideoDimensions(file);
      /* account for metadata rotation to get display dimensions */
      const displayW = (metaRotation === 90 || metaRotation === 270) ? dims.height : dims.width;
      const displayH = (metaRotation === 90 || metaRotation === 270) ? dims.width : dims.height;
      const isLandscape = displayW > 0 && displayH > 0 && displayW > displayH;

      /* build filter: rotate landscape to portrait, then scale/crop to 9:16 */
      const correction = rotationCorrectionFilter(metaRotation);
      const rotateFilter = isLandscape ? 'transpose=1,' : '';
      /* 540×960 preview — fast enough for on-load generation */
      const buildVf = (noAutorotate: boolean) =>
        noAutorotate
          ? `${correction}${rotateFilter}scale=540:960:force_original_aspect_ratio=increase,crop=540:960,setsar=1,format=yuv420p`
          : `${rotateFilter}scale=540:960:force_original_aspect_ratio=increase,crop=540:960,setsar=1,format=yuv420p`;

      const run = async (useNoAutorotate: boolean): Promise<boolean> => {
        const args: string[] = [
          ...(useNoAutorotate ? ['-noautorotate'] : []),
          '-i', inputName,
          '-t', '30',
          '-r', '30',
          '-vf', buildVf(useNoAutorotate),
          '-c:v', 'libx264',
          '-profile:v', 'baseline',
          '-level', '3.1',
          '-preset', 'ultrafast',
          '-crf', '28',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ar', '44100',
          '-ac', '2',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          '-f', 'mp4',
          '-y',
          outputName
        ];
        try {
          const ret = await ff.exec(args);
          return ret === 0;
        } catch {
          return false;
        }
      };

      let ok = await run(true);
      if (!ok) ok = await run(false);
      if (!ok) {
        throw new Error('ffmpeg_preview_failed');
      }

      let dataRaw: any;
      try {
        dataRaw = await ff.readFile(outputName);
      } catch {
        throw new Error('ffmpeg_read_preview_failed');
      }

      const bytes: Uint8Array = (dataRaw instanceof Uint8Array)
        ? dataRaw
        : (typeof dataRaw === 'string')
          ? new TextEncoder().encode(dataRaw)
          : new Uint8Array(dataRaw as ArrayBuffer);

      if (!bytes || bytes.length === 0) {
        throw new Error('ffmpeg_preview_empty');
      }

      return new Blob([bytes.buffer as ArrayBuffer], { type: 'video/mp4' });
    } finally {
      try { await ff.deleteFile(inputName); } catch {}
      try { await ff.deleteFile(outputName); } catch {}
    }
  }),
  convertToVertical: (file: File, settings: ConversionSettings): Promise<Blob> => withFFmpegQueue(async () => {
    if (!file || file.size === 0) {
       throw new Error('input_file_empty');
    }
    const ff = await loadFFmpeg();
    const inputExt = file.name.match(/\.[^.]+$/)?.[0] || '.mp4';
    const uid = crypto.randomUUID().replace(/-/g, '');
    const inputName = `cv_in_${uid}${inputExt}`;
    const outputName = `cv_out_${uid}.mp4`;

    try { await ff.deleteFile(inputName); } catch {}
    try { await ff.deleteFile(outputName); } catch {}
    try { await ff.deleteFile('logo.png'); } catch {}

    await ff.writeFile(inputName, await fetchFile(file));

    try {
      const { videoPts, atempo, speed } = buildSpeedFilters(settings.speed);

      const is4K = settings.outputQuality === '4k';
      /* 720p vertical por padrão no WASM — 1080p é muito lento no browser */
      const outW = is4K ? 2160 : 720;
      const outH = is4K ? 3840 : 1280;

      const dims = await videoProcessingService.getVideoDimensions(file);
      /* vídeo é horizontal se largura > altura considerando metadados de rotação */
      const displayW = (dims.width > 0 && dims.height > 0)
        ? ((dims.width > dims.height) ? dims.width : dims.height)
        : dims.width;
      const displayH = (dims.width > 0 && dims.height > 0)
        ? ((dims.width > dims.height) ? dims.height : dims.width)
        : dims.height;
      const isHorizontal = displayW > displayH;

      const useLogo = !!settings.logo;
      if (useLogo && settings.logo) {
        await ff.writeFile('logo.png', await fetchFile(settings.logo));
      }

      const posX = Math.round((settings.logoPosition?.x ?? 50) / 100 * outW);
      const posY = Math.round((settings.logoPosition?.y ?? 50) / 100 * outH);
      const scaleFactor = Math.max(0.05, Math.min(10, settings.logoScale || 1));

      /*
       * Filtro de vídeo:
       * 1) se horizontal → transpose=2 para rotacionar 90° CCW (portrait)
       * 2) scale para preencher outW×outH sem distorção, dimensões intermediárias pares
       * 3) crop central exato outW×outH
       * 4) setsar=1, setpts
       * Todas as dimensões intermediárias garantidas pares com trunc(x/2)*2
       */
      const buildVideoFilter = (_noAutorotate: boolean): string => {
        const rotate = isHorizontal ? 'transpose=2,' : '';
        /* scale condicional: mantém aspect ratio original
         * se iw/ih > outW/outH  → limita pela largura, calcula altura
         * caso contrário        → limita pela altura, calcula largura
         * pad completa o frame com preto sem cortar conteúdo
         * trunc(x/2)*2 garante dimensões pares em todos os cálculos */
        const scaleW = `trunc(if(gt(iw/ih,${outW}/${outH}),${outW},ih*${outW}/${outH})/2)*2`;
        const scaleH = `trunc(if(gt(iw/ih,${outW}/${outH}),iw*${outH}/${outW},${outH})/2)*2`;
        const scale  = `scale=${scaleW}:${scaleH}`;
        const pad    = `pad=${outW}:${outH}:(${outW}-iw)/2:(${outH}-ih)/2:black`;
        return `[0:v]${rotate}${scale},${pad},setsar=1,setpts=${videoPts}[v]`;
      };

      const buildFilterComplex = (noAutorotate: boolean): string => {
        const videoGraph = buildVideoFilter(noAutorotate);
        if (useLogo) {
          const logoW  = `trunc(iw*${scaleFactor}/2)*2`;
          const logoH  = `trunc(ih*${scaleFactor}/2)*2`;
          const clampX = `min(max(0,${posX}-w/2),W-w)`;
          const clampY = `min(max(0,${posY}-h/2),H-h)`;
          return `${videoGraph};[1:v]scale=${logoW}:${logoH}[wm];[v][wm]overlay=${clampX}:${clampY}[ov];[ov]format=yuv420p[vout]`;
        }
        return `${videoGraph};[v]format=yuv420p[vout]`;
      };

      /* 1ª tentativa: sem -noautorotate (deixa FFmpeg lidar com rotação automática) */
      /* 2ª tentativa: com -noautorotate (fallback para vídeos com metadados problemáticos) */
      const buildArgs = (noAutorotate: boolean): string[] => [
        ...(noAutorotate ? ['-noautorotate'] : []),
        '-i', inputName,
        ...(useLogo ? ['-i', 'logo.png'] : []),
        '-filter_complex', buildFilterComplex(noAutorotate),
        '-map', '[vout]',
        ...(settings.muteAudio ? ['-an'] : ['-map', '0:a?']),
        ...(settings.muteAudio ? [] : (speed !== 1 && atempo ? ['-af', atempo] : [])),
        '-c:v', 'libx264',
        '-profile:v', 'baseline',
        '-level', '3.1',
        '-preset', 'ultrafast',
        '-crf', is4K ? '20' : '26',
        ...(settings.muteAudio ? [] : ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2']),
        '-r', '30',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-f', 'mp4',
        '-y',
        outputName
      ];

      /* ── log detalhado para diagnóstico ── */
      const ffLogs: string[] = [];
      const logHandler = ({ message }: { message: string }) => {
        ffLogs.push(message);
      };
      try { ff.on('log', logHandler); } catch {}

      const runLogged = async (useNoAutorotate: boolean): Promise<boolean> => {
        const args = buildArgs(useNoAutorotate);
        console.group(`[FFmpeg] exec (noAutorotate=${useNoAutorotate})`);
        console.log('CMD: ffmpeg ' + args.join(' '));
        ffLogs.length = 0;
        let ret = -1;
        try {
          ret = await ff.exec(args);
        } catch (e) {
          console.error('[FFmpeg] exec threw:', e);
        }
        console.log('[FFmpeg] exit code:', ret);
        if (ret !== 0) {
          console.error('[FFmpeg] stderr output:\n' + ffLogs.join('\n'));
        }
        console.groupEnd();
        return ret === 0;
      };

      let success = await runLogged(true);
      if (!success) success = await runLogged(false);

      try { (ff as any).off('log', logHandler); } catch {}

      if (!success) {
        console.error('[FFmpeg] FALHA TOTAL. Últimos logs:\n' + ffLogs.join('\n'));
        throw new Error('ffmpeg_conversion_failed');
      }

      const dataRaw: any = await ff.readFile(outputName);
      const bytes: Uint8Array = dataRaw instanceof Uint8Array
        ? dataRaw
        : new Uint8Array(dataRaw as ArrayBuffer);

      if (!bytes || bytes.length === 0) throw new Error('ffmpeg_output_is_empty');

      return new Blob([bytes.buffer as ArrayBuffer], { type: 'video/mp4' });
    } finally {
      try { await ff.deleteFile(inputName); } catch {}
      try { await ff.deleteFile('logo.png'); } catch {}
      try { await ff.deleteFile(outputName); } catch {}
    }
  })
};

export async function getVideoMetadata(file: File): Promise<{ width: number; height: number; duration: number }> {
  return createTemporaryBlob(file, async (url) => {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      let done = false;
      const timeout = setTimeout(() => {
        if (!done) {
          cleanup();
          reject(new Error('video_metadata_timeout'));
        }
      }, 30000);
      const cleanup = () => {
        clearTimeout(timeout);
        v.removeEventListener('loadedmetadata', onLoaded);
        v.removeEventListener('error', onError);
        v.src = '';
      };
      const onLoaded = () => {
        if (done) return;
        done = true;
        try {
          const meta = { width: v.videoWidth, height: v.videoHeight, duration: v.duration };
          cleanup();
          resolve(meta);
        } catch (err) {
          cleanup();
          reject(err as any);
        }
      };
      const onError = () => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('video_metadata_error'));
      };
      v.addEventListener('loadedmetadata', onLoaded);
      v.addEventListener('error', onError);
      v.preload = 'metadata';
      v.src = url;
    });
  });
}

export async function validateConvertedVideo(finalBlob: Blob): Promise<boolean> {
  return createTemporaryBlob(finalBlob, async (url) => {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      let resolved = false;
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        v.removeEventListener('loadeddata', onOk);
        v.removeEventListener('error', onErr);
        v.src = '';
      };
      const onOk = () => { cleanup(); resolve(true); };
      const onErr = () => { cleanup(); resolve(false); };
      const t = setTimeout(() => { cleanup(); resolve(false); }, 10000);
      v.addEventListener('loadeddata', () => { clearTimeout(t); onOk(); });
      v.addEventListener('error', () => { clearTimeout(t); onErr(); });
      v.preload = 'auto';
      v.src = url;
    });
  });
}

function getQualitySettings(quality: 'low' | 'medium' | 'high' | 'ultra'): { video: readonly string[]; audio: readonly string[] } {
  const settings = {
    low: { video: ['-crf', '28', '-preset', 'ultrafast'], audio: ['-b:a', '96k', '-ar', '44100'] },
    medium: { video: ['-crf', '23', '-preset', 'medium'], audio: ['-b:a', '128k', '-ar', '44100'] },
    high: { video: ['-crf', '18', '-preset', 'slow'], audio: ['-b:a', '192k', '-ar', '48000'] },
    ultra: { video: ['-crf', '15', '-preset', 'veryslow'], audio: ['-b:a', '256k', '-ar', '48000'] }
  } as const;
  return settings[quality] || settings.high;
}



function logoOverlay(position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'): string {
  const pos = {
    'top-left': '10:10',
    'top-right': 'W-w-10:10',
    'bottom-left': '10:H-h-10',
    'bottom-right': 'W-w-10:H-h-10'
  } as const;
  return pos[position] || pos['bottom-right'];
}

export async function convertVideoToMP4(
  file: File,
  options: { quality?: 'low' | 'medium' | 'high' | 'ultra'; speed?: number; width?: number; height?: number; logo?: File; logoPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; muteAudio?: boolean } = {},
  onProgress?: (p: number) => void
): Promise<Blob> {
  const ff = await loadFFmpeg(onProgress);
  const inputName = 'input' + (file.name.match(/\.[^.]+$/)?.[0] || '.mp4');
  const outputName = 'output.mp4';
  await ff.writeFile(inputName, await fetchFile(file));
  const quality = getQualitySettings(options.quality || 'high');
  const meta = await getVideoMetadata(file);
  const metaRotation = await detectRotationMetadata(ff, inputName);
  const targetW = options.width || 1080;
  const targetH = options.height || 1920;
  const displayW = (metaRotation === 90 || metaRotation === 270) ? meta.height : meta.width;
  const displayH = (metaRotation === 90 || metaRotation === 270) ? meta.width : meta.height;
  const needsRotate = displayW > 0 && displayH > 0 && displayW >= displayH;
  const correction = rotationCorrectionFilter(metaRotation);
  const vfMainNoAutorotate = `${correction}${needsRotate ? 'transpose=1,' : ''}scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1`;
  const vfMainAutoRotate = `${needsRotate ? 'transpose=1,' : ''}scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1`;
  const muteAudio = !!options.muteAudio;

  const buildArgs = async (useNoAutorotate: boolean) => {
    const vfMain = useNoAutorotate ? vfMainNoAutorotate : vfMainAutoRotate;
    const vfLocal: string[] = [vfMain, 'format=yuv420p'];
    if (options.speed && options.speed !== 1) vfLocal.push(`setpts=${(1 / options.speed).toFixed(6)}*PTS`);

    const args: string[] = [];
    if (useNoAutorotate) args.push('-noautorotate');
    args.push('-i', inputName);
    if (options.logo) {
      await ff.writeFile('logo.png', await fetchFile(options.logo));
      args.push('-i', 'logo.png');
      args.push('-filter_complex', `[0:v]${vfLocal.join(',')}[v];[1:v]format=rgba[wm];[v][wm]overlay=${logoOverlay(options.logoPosition || 'bottom-right')}[vout]`);
      args.push('-map', '[vout]');
      if (!muteAudio) args.push('-map', '0:a?');
    } else {
      args.push('-vf', vfLocal.join(','));
      if (!muteAudio) args.push('-map', '0:a?');
    }
    args.push('-c:v', 'libx264');
    args.push(...quality.video);
    if (muteAudio) {
      args.push('-an');
    } else {
      args.push('-c:a', 'aac');
      args.push(...quality.audio);
    }
    if (!muteAudio && options.speed && options.speed !== 1) {
      const s = Math.max(0.1, Math.min(2.0, options.speed));
      const chain: string[] = [];
      let rem = s;
      while (rem < 0.5) { chain.push('0.5'); rem *= 2; }
      while (rem > 2.0) { chain.push('2.0'); rem /= 2; }
      chain.push(rem.toFixed(2));
      args.push('-af', chain.map(v => `atempo=${v}`).join(','));
    }
    args.push('-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-level', '4.0', '-shortest', '-y', outputName);
    return args;
  };

  try {
    await ff.exec(await buildArgs(true));
  } catch {
    await ff.exec(await buildArgs(false));
  }
  const dataRaw: any = await ff.readFile(outputName);
  const bytes: Uint8Array = (dataRaw instanceof Uint8Array)
    ? dataRaw
    : (typeof dataRaw === 'string')
      ? new TextEncoder().encode(dataRaw)
      : new Uint8Array(dataRaw as ArrayBuffer);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'video/mp4' });
  const ok = await validateConvertedVideo(blob);
  if (!ok) throw new Error('ffmpeg_output_corrupted');
  try { await ff.deleteFile(inputName); } catch {}
  try { await ff.deleteFile(outputName); } catch {}
  try { await ff.deleteFile('logo.png'); } catch {}
  return blob;
}
