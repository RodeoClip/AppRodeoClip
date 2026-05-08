import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ProcessingStatus } from '../types';
import { api } from '../services/apiService';
import { CheckCircle, Download, Loader2, CreditCard, XCircle, AlertTriangle } from 'lucide-react';
import { fsService } from '../services/fsService';
import { videoProcessingService } from '../services/videoProcessingService';
import { PRICE_MONTHLY } from '../constants';

export const ProcessingModal: React.FC = () => {
  const { state, dispatch } = useApp();
  const { status, session } = state;
  const [isConverting, setIsConverting] = useState(false);
  const priceBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(PRICE_MONTHLY);

  if (status === ProcessingStatus.IDLE || status === ProcessingStatus.PREVIEW_GENERATING) return null;

  const handleCheckout = async () => {
    try {
      const { checkoutUrl, sessionId } = await api.checkout();
      if (checkoutUrl && checkoutUrl !== '#') {
        try { await fetch('/api/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'checkout_open', url: checkoutUrl, ts: Date.now() }) }); } catch {}
        window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
      }
      const userSession = await api.validatePayment(sessionId);
      dispatch({ type: 'SET_SESSION', payload: userSession });
      dispatch({ type: 'SET_STATUS', payload: ProcessingStatus.PAID });
    } catch {
      alert('Falha ao iniciar o pagamento. Tente novamente.');
    }
  };

  const handleConvertAndDownload = async () => {
    if (isConverting) return;
    setIsConverting(true);
    dispatch({ type: 'SET_STATUS', payload: ProcessingStatus.PROCESSING });
    try {
      const canPickDir = !!(window as any).showDirectoryPicker;
      const dir = canPickDir ? await fsService.ensureDownloadDirectory() : null;
      await videoProcessingService.preload();
      dispatch({ type: 'SET_PROGRESS', payload: { total: state.files.length, completed: 0 } });
      for (let i = 0; i < state.files.length; i++) {
        const f = state.files[i];
        const src = String((f as any).relativePath || f.file.name);
        const dotIndex = src.lastIndexOf('.');
        const base = dotIndex > 0 ? src.substring(0, dotIndex) : src;
        const prefix = String(i + 1).padStart(3, '0');
        const outName = `${prefix}_${base}_convertido.mp4`;
        const converted = await videoProcessingService.convertToVertical(f.file, state.settings);
        if (dir) {
          await fsService.writeFileFromBlob(converted, outName, dir);
        } else {
          fsService.saveStandard(converted, outName);
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        dispatch({ type: 'SET_PROGRESS', payload: { total: state.files.length, completed: i + 1 } });
      }
      dispatch({ type: 'SET_STATUS', payload: ProcessingStatus.COMPLETED });
    } catch (e) {
      const detail = e instanceof Error ? e.message : (typeof e === 'string' ? e : '');
      alert(detail ? `Falha ao converter o vídeo. (${detail})` : 'Falha ao converter o vídeo. Tente novamente.');
      dispatch({ type: 'SET_STATUS', payload: ProcessingStatus.FAILED });
    } finally {
      setIsConverting(false);
    }
  };

  const progressPct = state.progress.total > 0
    ? Math.round((state.progress.completed / state.progress.total) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-rodeo-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl relative overflow-hidden">

        {/* Barra decorativa topo */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rodeo-500 via-yellow-500 to-rodeo-500" />

        <div className="text-center mb-6 mt-4">
          <h2 className="text-2xl font-brand text-white">RodeoClip</h2>
        </div>

        {/* PRONTO PARA PAGAR */}
        {status === ProcessingStatus.READY_TO_PAY && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-4 rounded-lg flex items-center justify-between">
              <span className="text-gray-300">Assinatura Mensal</span>
              <span className="text-xl font-bold text-white">{priceBRL}</span>
            </div>
            <ul className="text-sm text-gray-400 space-y-2 text-left pl-2">
              <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" /> Conversões ilimitadas</li>
              <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" /> Sem marcas d'água</li>
              <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" /> Processamento prioritário</li>
            </ul>
            <button
              onClick={handleCheckout}
              className="w-full py-4 bg-rodeo-500 hover:bg-rodeo-400 text-black font-bold text-lg rounded-xl flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
            >
              <CreditCard className="w-5 h-5" />
              Assinar agora
            </button>
          </div>
        )}

        {/* PAGO — PRONTO PARA CONVERTER */}
        {status === ProcessingStatus.PAID && (
          <div className="text-center space-y-6">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <div>
              <h3 className="text-white text-lg font-bold">Pagamento confirmado!</h3>
              <p className="text-gray-400 text-sm mt-1">
                {state.files.length} vídeo{state.files.length !== 1 ? 's' : ''} pronto{state.files.length !== 1 ? 's' : ''} para converter.
              </p>
            </div>
            <button
              onClick={handleConvertAndDownload}
              className="w-full py-3 bg-rodeo-500 hover:bg-rodeo-400 text-black font-bold rounded-xl flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
            >
              <Download className="w-5 h-5" />
              Converter e baixar agora
            </button>
          </div>
        )}

        {/* PROCESSANDO */}
        {status === ProcessingStatus.PROCESSING && (
          <div className="text-center space-y-6 py-4">
            <Loader2 className="w-12 h-12 text-rodeo-500 animate-spin mx-auto" />
            <div className="space-y-1">
              <h3 className="text-white font-medium">Convertendo seus vídeos...</h3>
              <p className="text-xs text-gray-500">Renderizando em formato vertical de alta qualidade.</p>
              <p className="text-sm text-rodeo-400 font-mono mt-2">
                {state.progress.completed}/{state.progress.total} vídeos concluídos
              </p>
            </div>
            {state.progress.total > 0 && (
              <div className="w-full">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Progresso</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-rodeo-500 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
            <p className="text-xs text-gray-600">Não feche esta janela durante a conversão.</p>
          </div>
        )}

        {/* FALHA */}
        {status === ProcessingStatus.FAILED && (
          <div className="text-center space-y-6 py-4">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <div>
              <h3 className="text-white font-medium">Falha na conversão</h3>
              <p className="text-xs text-gray-500 mt-1">Verifique se o vídeo está em formato suportado e tente novamente.</p>
            </div>
            <button
              onClick={handleConvertAndDownload}
              className="w-full py-3 bg-rodeo-500 hover:bg-rodeo-400 text-black font-bold rounded-lg transition-colors"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* CONCLUÍDO */}
        {status === ProcessingStatus.COMPLETED && (
          <div className="text-center space-y-6">
            <div className="w-16 h-16 bg-rodeo-500/20 rounded-full flex items-center justify-center mx-auto">
              <Download className="w-8 h-8 text-rodeo-500" />
            </div>
            <div>
              <h3 className="text-white font-brand text-xl">Pronto para as redes!</h3>
              <p className="text-gray-400 text-sm mt-1">
                {state.progress.total > 0 ? `${state.progress.total} vídeo${state.progress.total !== 1 ? 's' : ''} convertido${state.progress.total !== 1 ? 's' : ''} com sucesso.` : 'Conversão concluída com sucesso.'}
              </p>
            </div>
            <button
              onClick={() => {
                dispatch({ type: 'SET_STATUS', payload: ProcessingStatus.IDLE });
                dispatch({ type: 'SET_FILES', payload: [] });
              }}
              className="w-full py-4 bg-rodeo-500 hover:bg-rodeo-400 text-black font-bold rounded-xl transition-all"
            >
              Converter novos vídeos
            </button>
            <button
              onClick={() => dispatch({ type: 'SET_STATUS', payload: ProcessingStatus.IDLE })}
              className="text-gray-500 hover:text-white text-sm"
            >
              Fechar
            </button>
          </div>
        )}

        {/* BOTÃO FECHAR (exceto durante processamento) */}
        {status !== ProcessingStatus.PROCESSING && (
          <button
            onClick={() => dispatch({ type: 'SET_STATUS', payload: ProcessingStatus.IDLE })}
            className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
          >
            <XCircle className="w-6 h-6" />
          </button>
        )}
      </div>
    </div>
  );
};
