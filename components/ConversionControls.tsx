import React from 'react';
import { useApp } from '../context/AppContext';
import { Sliders, ImageIcon, Maximize2, Volume2, VolumeX, Trash2 } from 'lucide-react';
import { logger } from '../services/loggingService';
import { blobManager } from '../services/blobManager';

export const ConversionControls: React.FC = () => {
  const { state, dispatch } = useApp();
  const { settings } = state;
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = blobManager.create('logo', file);
    dispatch({ type: 'UPDATE_SETTINGS', payload: { logo: file, logoUrl: url, logoPosition: { x: 50, y: 50 } } });
    logger.log('logo_uploaded');
  };

  const removeLogo = () => {
    blobManager.revoke('logo');
    dispatch({ type: 'UPDATE_SETTINGS', payload: { logo: null, logoUrl: null, logoEditing: false } });
  };

  /* section helper */
  const Section = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
    <div>
      <p className="flex items-center gap-2 text-xs font-semibold text-white uppercase tracking-wider mb-2.5">
        <span className="text-amber-500">{icon}</span>
        {title}
      </p>
      {children}
    </div>
  );

  return (
    <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl overflow-hidden flex flex-col">
      {/* scrollable content */}
      <div className="overflow-y-auto flex-1 p-4 space-y-5">

        {/* ── Velocidade ── */}
        <Section icon={<Sliders className="w-3.5 h-3.5" />} title="Velocidade">
          <div className="flex items-center gap-3">
            <input
              type="range" min="0.1" max="2.0" step="0.1"
              value={settings.speed}
              onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { speed: parseFloat(e.target.value) } })}
              className="flex-1"
            />
            <span className="text-amber-400 font-mono text-sm w-10 text-right shrink-0">{settings.speed}x</span>
          </div>
          <div className="flex justify-between text-xs text-gray-600 mt-1 px-0.5">
            <span>Câmera lenta</span><span>Normal</span><span>Rápido</span>
          </div>
        </Section>

        <hr className="border-white/[0.06]" />

        {/* ── Qualidade ── */}
        <Section icon={<Maximize2 className="w-3.5 h-3.5" />} title="Qualidade de saída">
          <div className="flex gap-2">
            {(['1080p', '4k'] as const).map(q => (
              <button key={q}
                onClick={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { outputQuality: q } })}
                className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${
                  settings.outputQuality === q
                    ? 'bg-amber-500 text-black border-amber-500'
                    : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {q === '4k' ? '4K' : '720p'}
                {q === '4k' && <span className="ml-1 text-xs opacity-60 font-normal">(lento)</span>}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-1.5">
            {settings.outputQuality === '4k' ? 'Saída 2160×3840 — conversão mais lenta' : 'Saída 720×1280 — conversão rápida'}
          </p>
        </Section>

        <hr className="border-white/[0.06]" />

        {/* ── Áudio ── */}
        <Section icon={settings.muteAudio ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />} title="Áudio">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div
              onClick={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { muteAudio: !settings.muteAudio } })}
              className={`relative w-10 h-5 rounded-full transition-colors ${settings.muteAudio ? 'bg-amber-500' : 'bg-gray-700'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.muteAudio ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm text-gray-300">
              {settings.muteAudio ? 'Áudio silenciado' : 'Áudio original'}
            </span>
          </label>
        </Section>

        <hr className="border-white/[0.06]" />

        {/* ── Logo ── */}
        <Section icon={<ImageIcon className="w-3.5 h-3.5" />} title="Logo / Watermark">
          {!settings.logoUrl ? (
            <label className="flex flex-col items-center justify-center gap-1.5 w-full h-20
              border-2 border-dashed border-gray-700 rounded-lg cursor-pointer
              bg-gray-800/60 hover:bg-gray-700/60 hover:border-amber-500/50 transition-all text-gray-500">
              <ImageIcon className="w-5 h-5" />
              <span className="text-xs">Clique para adicionar logo (PNG)</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoUpload} />
            </label>
          ) : (
            <div className="space-y-3">
              {/* preview + remove */}
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-lg bg-black/50 border border-gray-700 flex items-center justify-center overflow-hidden shrink-0">
                  <img src={settings.logoUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-400 truncate">Logo carregada</p>
                  <p className="text-xs text-gray-600 mt-0.5">Duplo-clique no preview para resetar tamanho</p>
                </div>
                <button onClick={removeLogo} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-gray-500 text-center">
                Arraste a logo no preview para reposicionar · scroll para redimensionar
              </p>
            </div>
          )}
        </Section>

      </div>
    </div>
  );
};
