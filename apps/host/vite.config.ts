import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /preview /artifacts /api 全部代理到 mock-server：iframe 与宿主同源，postMessage 与调试都简单
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:5173',
      '/preview': 'http://localhost:5173',
      '/artifacts': 'http://localhost:5173',
    },
  },
});
