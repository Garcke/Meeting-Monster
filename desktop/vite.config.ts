import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: './',
  root: path.resolve(__dirname, 'ui'),
  plugins: [react()],
  publicDir: path.resolve(__dirname, 'ui/public'),
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        overlay: path.resolve(__dirname, 'ui/overlay.html'),
      },
    },
  },
});
