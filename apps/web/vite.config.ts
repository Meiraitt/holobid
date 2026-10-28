import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

import { apiOrigin } from './src/services/api-client';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const proxy = {
    '/api/v1/auth': {
      target: apiOrigin(env.VITE_API_URL || 'http://127.0.0.1:3000'),
      changeOrigin: true,
    },
  };

  return {
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'api-connection-hints',
        transformIndexHtml() {
          if (!env.VITE_API_URL) {
            return [];
          }

          return [
            {
              tag: 'link',
              attrs: { rel: 'preconnect', href: apiOrigin(env.VITE_API_URL), crossorigin: '' },
            },
          ];
        },
      },
    ],
    server: { host: '127.0.0.1', port: 5173, proxy },
    preview: { proxy },
  };
});
