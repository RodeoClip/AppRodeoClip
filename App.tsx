
import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { UploadZone } from './components/UploadZone';
import { VideoPreview } from './components/VideoPreview';
import { ConversionControls } from './components/ConversionControls';
import { ProcessingModal } from './components/ProcessingModal';
import { ArrowRight } from 'lucide-react';
import { fsService } from './services/fsService';
import { videoProcessingService } from './services/videoProcessingService';

const RodeoClipApp: React.FC = () => {
  const { state, dispatch } = useApp();
  const [isDownloading, setIsDownloading] = React.useState(false);

  const handleDownloadClick = async () => {
    if (state.files.length === 0 || isDownloading) return;
    setIsDownloading(true);
    dispatch({ type: 'SET_PROGRESS', payload: { total: state.files.length, completed: 0 } });

    const makeOutName = (f: any, index: number) => {
      const src = String(f?.relativePath || f?.file?.name || '');
      const dotIndex = src.lastIndexOf('.');
      const base = dotIndex > 0 ? src.substring(0, dotIndex) : src;
      const prefix = String(index + 1).padStart(3, '0');
      const qualityTag = state.settings.outputQuality === '4k' ? '_4k' : '_1080p';
      return `${prefix}_${base}_convertido${qualityTag}.mp4`;
    };

    await videoProcessingService.preload();
    for (let i = 0; i < state.files.length; i++) {
      const f = state.files[i];
      try {
        const outName = makeOutName(f, i);
        const converted = await videoProcessingService.convertToVertical(f.file, state.settings);
        fsService.saveStandard(converted, outName);
      } catch (e) {
        console.error('Conversion failed', e);
        const detail = e instanceof Error ? e.message : '';
        alert(detail ? `Falha ao converter o vídeo. (${detail})` : 'Falha ao converter o vídeo. Tente novamente.');
        setIsDownloading(false);
        return;
      }
      dispatch({ type: 'SET_PROGRESS', payload: { total: state.files.length, completed: i + 1 } });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    setIsDownloading(false);
  };

  const pct = state.progress.total > 0
    ? Math.round((state.progress.completed / state.progress.total) * 100) : 0;

  return (
    <div className="min-h-dvh bg-[#1a1818] text-gray-100 flex flex-col">

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 h-16 bg-[#1a1818]/95 backdrop-blur border-b border-white/[0.06] flex items-center px-4 md:px-6">
        <div className="max-w-screen-xl w-full mx-auto flex items-center justify-between">
          <img src="/logo.png" alt="RodeoClip" className="h-11 w-auto object-contain drop-shadow-[0_0_8px_rgba(217,119,6,.4)]" />
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-600 hidden sm:block tracking-widest uppercase">Conversor Vertical</span>
            {state.session.isAuthenticated && (
              <span className="text-[11px] font-bold tracking-wide px-2.5 py-1 rounded-full bg-emerald-900/30 text-emerald-400 border border-emerald-800/50">
                PRO ATIVA
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 max-w-screen-xl w-full mx-auto px-3 py-4 md:px-6 md:py-5
        grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4
        min-h-0" style={{ height: 'calc(100dvh - 64px)' }}>

        {/* Left: upload + controls */}
        <div className="flex flex-col gap-3 min-h-0 overflow-y-auto pb-2 pr-1">
          <UploadZone />
          <div className="flex-1 min-h-0">
            <ConversionControls />
          </div>
        </div>

        {/* Right: preview + download */}
        <div className="flex flex-col gap-4 bg-white/[0.02] border border-white/[0.06] rounded-2xl p-4 md:p-5 min-h-0">

          {/* preview — takes all available height */}
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <VideoPreview />
          </div>

          {/* download button */}
          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={handleDownloadClick}
              disabled={state.files.length === 0 || isDownloading}
              className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-extrabold text-base
                transition-all shadow-lg
                ${state.files.length === 0
                  ? 'bg-gray-800 text-gray-500 cursor-not-allowed shadow-none'
                  : isDownloading
                    ? 'bg-amber-500/75 text-black cursor-wait'
                    : 'bg-amber-500 text-black hover:bg-amber-400 hover:scale-[1.015] active:scale-95 shadow-amber-900/40'
                }`}
            >
              {isDownloading
                ? (<><svg className="spin w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>Convertendo…</>)
                : (<><ArrowRight className="w-5 h-5 shrink-0" />Fazer download</>)
              }
            </button>

            {isDownloading && state.progress.total > 0 && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Convertendo vídeos</span>
                  <span>{state.progress.completed}/{state.progress.total} — {pct}%</span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <ProcessingModal />
    </div>
  );
};

// Wrap with Provider
const App: React.FC = () => {
  return (
    <AppProvider>
      <RodeoClipApp />
    </AppProvider>
  );
};

export default App;
