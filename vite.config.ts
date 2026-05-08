import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const disableCheckout = String(env.VITE_DISABLE_CHECKOUT || '').toLowerCase() === 'true';
    const port = Number(env.VITE_PORT || env.PORT || 3011);
    const hmrHost = String(env.VITE_HMR_HOST || 'localhost');
    const hmrPortRaw = String(env.VITE_HMR_PORT || '');
    const hmrPort = hmrPortRaw ? Number(hmrPortRaw) : undefined;
    const cacheDir = String(env.VITE_CACHE_DIR || '');
  return {
      ...(cacheDir ? { cacheDir } : {}),
      server: {
        port,
        strictPort: true,
        host: '0.0.0.0',
        headers: {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp'
        },
        ...(hmrPort
          ? {
              hmr: {
                protocol: 'ws',
                host: hmrHost,
                port: hmrPort,
                clientPort: hmrPort
              }
            }
          : {})
      },
      plugins: [tailwindcss(), react()],
      optimizeDeps: {
        exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/core', '@ffmpeg/util']
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL),
        'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY),
        'process.env.STRIPE_PUBLISHABLE_KEY': JSON.stringify(disableCheckout ? '' : env.STRIPE_PUBLISHABLE_KEY),
        'process.env.STRIPE_PRICE_ID': JSON.stringify(disableCheckout ? '' : env.STRIPE_PRICE_ID),
        'process.env.STRIPE_PAYMENT_LINK_URL': JSON.stringify(disableCheckout ? '' : env.STRIPE_PAYMENT_LINK_URL)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
