import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { Loader2, Play, Pause, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { videoProcessingService } from '../services/videoProcessingService';
import { blobManager } from '../services/blobManager';

export const VideoPreview: React.FC = () => {
  const { state, dispatch } = useApp();
  const { activeFileId, files, settings } = state;

  const containerRef  = useRef<HTMLDivElement>(null);
  const videoRef      = useRef<HTMLVideoElement>(null);
  const logoRef       = useRef<HTMLDivElement>(null);

  const compatAttempted = useRef<Set<string>>(new Set());
  const dragOffset      = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const logoSize        = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  const [isPlaying,         setIsPlaying]         = useState(false);
  const [isReady,           setIsReady]           = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [loadAttempts,      setLoadAttempts]      = useState(0);
  const [generatingCompat,  setGeneratingCompat]  = useState(false);
  const [compatTick,        setCompatTick]        = useState(0);
  const [retryTick,         setRetryTick]         = useState(0);
  const [meta,              setMeta]              = useState<{ w: number; h: number; dur: number } | null>(null);
  const [dragging,          setDragging]          = useState(false);
  const [logoNatural,       setLogoNatural]       = useState<{ w: number; h: number } | null>(null);
  const [volume,            setVolume]            = useState(1);

  /* ── cleanup compat blobs on unmount ── */
  useEffect(() => {
    return () => {
      compatAttempted.current.forEach(id => blobManager.revoke(`compat:${id}`));
      compatAttempted.current.clear();
    };
  }, []);

  /* ── reset on file change ── */
  useEffect(() => {
    setIsReady(false);
    setIsPlaying(false);
    setError(null);
    setLoadAttempts(0);
    setGeneratingCompat(false);
    setMeta(null);
  }, [activeFileId]);

  /* ── auto-convert to vertical 9:16 on load ── */
  useEffect(() => {
    const activeFile = files.find(f => f.id === activeFileId);
    if (!activeFile) return;
    const compatId = `compat:${activeFile.id}`;
    if (blobManager.has(compatId)) return;
    if (compatAttempted.current.has(activeFile.id)) return;
    compatAttempted.current.add(activeFile.id);
    let alive = true;
    setGeneratingCompat(true);
    setError(null);
    setIsReady(false);
    (async () => {
      try {
        await videoProcessingService.preload();
        const blob = await Promise.race([
          videoProcessingService.transcodeForPreview(activeFile.file),
          new Promise<Blob>((_, rej) => setTimeout(() => rej(new Error('compat_timeout')), 120000))
        ]);
        if (!alive) { return; }
        blobManager.create(compatId, blob);
        setCompatTick(t => t + 1);
      } catch (e) {
        if (!alive) return;
        setError((e as any)?.message === 'compat_timeout'
          ? 'Preview demorou demais para gerar'
          : 'Falha ao gerar preview vertical');
      } finally {
        if (alive) setGeneratingCompat(false);
      }
    })();
    return () => { alive = false; };
  }, [activeFileId, retryTick]);

  /* ── sync speed ── */
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = settings.speed;
  }, [settings.speed, activeFileId]);

  /* ── sync mute / volume ── */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted  = false;
    v.volume = settings.muteAudio ? 0 : volume;
  }, [settings.muteAudio, volume, activeFileId]);

  /* ── load video ── */
  useEffect(() => {
    const video = videoRef.current;
    const activeFile = files.find(f => f.id === activeFileId);
    if (!video || !activeFile) return;

    /* always use the FFmpeg-converted vertical blob; never load raw previewUrl */
    const url = blobManager.get(`compat:${activeFile.id}`);
    if (!url) return;

    let alive = true;
    setIsReady(false);
    setError(null);
    setIsPlaying(false);
    video.muted  = false;
    video.volume = settings.muteAudio ? 0 : volume;

    /* timeout fallback */
    const timeout = setTimeout(() => {
      if (alive && !isReady) setError('Tempo esgotado ao carregar o preview');
    }, 10000);

    const onLoaded = () => {
      if (!alive) return;
      clearTimeout(timeout);
      setIsReady(true);
      setError(null);
      try {
        const v = videoRef.current!;
        setMeta({ w: v.videoWidth, h: v.videoHeight, dur: v.duration });
      } catch {}
    };
    const onCanPlay = () => { if (alive) { clearTimeout(timeout); setIsReady(true); } };
    const onPlay    = () => { if (alive) setIsPlaying(true); };
    const onPause   = () => { if (alive) setIsPlaying(false); };
    const onError   = () => {
      if (!alive) return;
      const code = (video as any)?.error?.code ?? null;
      const msg =
        code === 4 ? 'Formato não suportado no preview' :
        code === 3 ? 'Falha ao decodificar o vídeo' :
        code === 2 ? 'Erro de rede ao carregar o preview' :
        'Erro ao carregar o vídeo';
      setError(msg);
      setIsReady(false);
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('loadeddata',     onLoaded);
    video.addEventListener('canplay',        onCanPlay);
    video.addEventListener('play',           onPlay);
    video.addEventListener('pause',          onPause);
    video.addEventListener('error',          onError);

    /* set source */
    while (video.firstChild) video.removeChild(video.firstChild);
    const src = document.createElement('source');
    src.src  = url;
    const fmt = activeFile.format || activeFile.file.type || '';
    if (fmt.startsWith('video/')) src.type = fmt;
    video.appendChild(src);
    video.load();

    return () => {
      alive = false;
      clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('loadeddata',     onLoaded);
      video.removeEventListener('canplay',        onCanPlay);
      video.removeEventListener('play',           onPlay);
      video.removeEventListener('pause',          onPause);
      video.removeEventListener('error',          onError);
      try { video.pause(); } catch {}
      video.src = '';
    };
  }, [activeFileId, compatTick, loadAttempts]);

  /* ── play/pause toggle ── */
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !isReady) return;
    if (isPlaying) v.pause();
    else { v.muted = false; v.volume = settings.muteAudio ? 0 : volume; v.play().catch(() => {}); }
  }, [isPlaying, isReady, settings.muteAudio]);

  /* ── logo drag ── */
  const onLogoPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const el  = logoRef.current!;
    const r   = el.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
    logoSize.current   = { w: r.width, h: r.height };
    setDragging(true);
    el.setPointerCapture(e.pointerId);
  };

  const onLogoPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const cr = containerRef.current!.getBoundingClientRect();
    const hw = logoSize.current.w / 2, hh = logoSize.current.h / 2;
    const cx = Math.max(hw, Math.min(e.clientX - cr.left - dragOffset.current.x, cr.width  - hw));
    const cy = Math.max(hh, Math.min(e.clientY - cr.top  - dragOffset.current.y, cr.height - hh));
    dispatch({ type: 'UPDATE_SETTINGS', payload: { logoPosition: { x: (cx / cr.width) * 100, y: (cy / cr.height) * 100 } } });
  };

  const onLogoPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    logoRef.current?.releasePointerCapture(e.pointerId);
  };

  const onWheelLogo = (e: React.WheelEvent) => {
    e.preventDefault();
    const next = Math.min(10, Math.max(0.05, (settings.logoScale || 1) * (e.deltaY > 0 ? 0.95 : 1.05)));
    dispatch({ type: 'UPDATE_SETTINGS', payload: { logoScale: parseFloat(next.toFixed(3)) } });
  };

  /* ── logo corner resize ── */
  const resizeStart = useRef<{ startX: number; startY: number; startScale: number; corner: string } | null>(null);

  const onCornerPointerDown = (e: React.PointerEvent<HTMLDivElement>, corner: string) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    resizeStart.current = { startX: e.clientX, startY: e.clientY, startScale: settings.logoScale || 1, corner };
  };

  const onCornerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current || !logoNatural) return;
    const { startX, startY, startScale, corner } = resizeStart.current;
    const cr = containerRef.current!.getBoundingClientRect();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const delta = (corner === 'br' || corner === 'tr') ? dx : -dx;
    const refSize = Math.max(logoNatural.w, logoNatural.h);
    const newScale = Math.min(10, Math.max(0.05, startScale + delta / refSize));
    dispatch({ type: 'UPDATE_SETTINGS', payload: { logoScale: parseFloat(newScale.toFixed(3)) } });
  };

  const onCornerPointerUp = () => { resizeStart.current = null; };

  const activeFile = files.find(f => f.id === activeFileId);

  /* ── empty state ── */
  if (!activeFile) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <div className="preview-frame flex items-center justify-center" style={{ height: 'min(560px, 100%)' }}>
          <div className="text-center px-6">
            <div className="w-16 h-16 rounded-full bg-blue-900/30 border-2 border-blue-500/40 flex items-center justify-center mx-auto mb-4">
              <Play className="w-7 h-7 text-blue-400" />
            </div>
            <p className="text-blue-400 font-semibold text-base">Nenhum vídeo selecionado</p>
            <p className="text-gray-500 text-sm mt-1">Adicione vídeos para ver o preview 9:16</p>
          </div>
        </div>
      </div>
    );
  }

  /* if auto-convert is still pending (edge: file was already attempted but no compat) show spinner */
  const hasCompatBlob = blobManager.has(`compat:${activeFile.id}`);
  if (!hasCompatBlob && !generatingCompat && !error) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <div className="preview-frame flex items-center justify-center" style={{ height: 'min(560px, 100%)' }}>
          <div className="text-center px-6">
            <Loader2 className="w-9 h-9 text-amber-500 spin mx-auto mb-3" />
            <p className="text-white text-sm font-medium">Preparando preview…</p>
          </div>
        </div>
      </div>
    );
  }

  /* preview is always the FFmpeg-converted vertical blob — no CSS rotation needed */
  const videoStyle: React.CSSProperties = { objectFit: 'cover' };

  const fmtDur = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="flex flex-col items-center w-full h-full gap-3">

      {/* ── 9:16 frame ── */}
      <div className="flex-1 flex items-center justify-center w-full min-h-0">
        <div
          ref={containerRef}
          className="preview-frame select-none"
          style={{ height: 'min(560px, 100%)', width: 'auto' }}
          onPointerMove={onLogoPointerMove}
          onPointerUp={onLogoPointerUp}
          onPointerLeave={onLogoPointerUp}
        >
          {/* loading spinner */}
          {!isReady && !error && !generatingCompat && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-900/90">
              <Loader2 className="w-9 h-9 text-amber-500 spin" />
            </div>
          )}

          {/* converting to vertical preview */}
          {generatingCompat && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/85">
              <div className="text-center px-6">
                <Loader2 className="w-9 h-9 text-amber-500 spin mx-auto mb-3" />
                <p className="text-white text-sm font-medium">Convertendo para 9:16…</p>
                <p className="text-gray-400 text-xs mt-1">Aguarde, isso leva alguns segundos</p>
              </div>
            </div>
          )}

          {/* error overlay */}
          {error && !generatingCompat && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/85">
              <div className="text-center px-6">
                <p className="text-white font-semibold mb-1">Erro ao carregar vídeo</p>
                <p className="text-gray-300 text-xs mb-4">{error}</p>
                <button
                  onClick={() => {
                    if (!activeFile) return;
                    /* clear flags so the auto-convert effect re-fires */
                    compatAttempted.current.delete(activeFile.id);
                    blobManager.revoke(`compat:${activeFile.id}`);
                    setError(null);
                    setLoadAttempts(0);
                    setRetryTick(t => t + 1);
                  }}
                  className="flex items-center gap-2 mx-auto px-4 py-2 bg-amber-600 hover:bg-amber-500 text-black font-bold rounded-lg text-sm transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Tentar novamente
                </button>
              </div>
            </div>
          )}

          {/* video element — nunca muted via atributo, volume controlado por JS */}
          <video
            ref={videoRef}
            className="w-full h-full"
            style={videoStyle}
            playsInline
            loop
          />

          {/* logo overlay — sempre arrastável + handles de canto */}
          {settings.logoUrl && logoNatural && (
            <div
              ref={logoRef}
              className="logo-handle editable"
              style={{
                left:      `${settings.logoPosition.x}%`,
                top:       `${settings.logoPosition.y}%`,
                width:     `${logoNatural.w * (settings.logoScale || 1)}px`,
                height:    `${logoNatural.h * (settings.logoScale || 1)}px`,
                transform: 'translate(-50%, -50%)',
              }}
              onPointerDown={onLogoPointerDown}
              onPointerMove={onLogoPointerMove}
              onPointerUp={onLogoPointerUp}
              onWheel={onWheelLogo}
              onDragStart={e => e.preventDefault()}
              onDoubleClick={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { logoScale: 0.3 } })}
            >
              <img
                src={settings.logoUrl}
                alt="Logo"
                className="w-full h-full object-contain pointer-events-none"
                draggable={false}
                onLoad={e => {
                  const img = e.currentTarget as HTMLImageElement;
                  setLogoNatural({ w: img.naturalWidth, h: img.naturalHeight });
                }}
              />
              {/* resize handles nos 4 cantos */}
              {(['tl','tr','bl','br'] as const).map(corner => (
                <div
                  key={corner}
                  className="logo-resize-handle"
                  data-corner={corner}
                  style={{
                    top:    corner.startsWith('t') ? -5 : 'auto',
                    bottom: corner.startsWith('b') ? -5 : 'auto',
                    left:   corner.endsWith('l')   ? -5 : 'auto',
                    right:  corner.endsWith('r')   ? -5 : 'auto',
                  }}
                  onPointerDown={e => onCornerPointerDown(e, corner)}
                  onPointerMove={onCornerPointerMove}
                  onPointerUp={onCornerPointerUp}
                />
              ))}
            </div>
          )}
          {/* pre-load logo image for natural dimensions even when logoNatural is null */}
          {settings.logoUrl && !logoNatural && (
            <img
              src={settings.logoUrl}
              alt=""
              className="absolute opacity-0 pointer-events-none"
              draggable={false}
              onLoad={e => {
                const img = e.currentTarget as HTMLImageElement;
                setLogoNatural({ w: img.naturalWidth, h: img.naturalHeight });
              }}
            />
          )}

          {/* play/pause overlay */}
          {!error && !generatingCompat && (
            <div
              className="absolute inset-0 flex items-center justify-center cursor-pointer transition-colors"
              style={{ background: isPlaying ? 'transparent' : 'rgba(0,0,0,0.18)' }}
              onClick={togglePlay}
            >
              {!isPlaying && isReady && (
                <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/40 hover:bg-white/30 transition-colors">
                  <Play className="w-7 h-7 text-white fill-white ml-1" />
                </div>
              )}
              {isPlaying && (
                <div className="w-14 h-14 bg-black/20 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                  <Pause className="w-7 h-7 text-white fill-white" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── info bar + volume ── */}
      <div className="w-full max-w-xs mx-auto space-y-1.5">
        <p className="text-xs text-gray-400 font-mono truncate text-center">{activeFile.file.name}</p>
        <p className="text-xs text-gray-600 text-center">
          {(activeFile.size / 1024 / 1024).toFixed(1)} MB
          {meta ? ` · ${fmtDur(meta.dur)}` : ''}
          {' · '}{settings.outputQuality === '4k' ? '4K' : '1080p'}
          {' · '}{settings.speed}x
        </p>

        {/* controle de volume */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { muteAudio: !settings.muteAudio } })}
            className="text-gray-400 hover:text-white transition-colors shrink-0"
          >
            {settings.muteAudio || volume === 0
              ? <VolumeX className="w-4 h-4" />
              : <Volume2 className="w-4 h-4" />
            }
          </button>
          <input
            type="range" min={0} max={1} step={0.01}
            value={settings.muteAudio ? 0 : volume}
            onChange={e => {
              const v = parseFloat(e.target.value);
              setVolume(v);
              if (videoRef.current) videoRef.current.volume = v;
              if (settings.muteAudio && v > 0)
                dispatch({ type: 'UPDATE_SETTINGS', payload: { muteAudio: false } });
            }}
            className="flex-1"
          />
          <span className="text-xs text-gray-500 w-8 text-right shrink-0">
            {settings.muteAudio ? '0%' : `${Math.round(volume * 100)}%`}
          </span>
        </div>
      </div>
    </div>
  );
};
