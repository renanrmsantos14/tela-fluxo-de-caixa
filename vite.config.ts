import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: process.env.VITE_BUILD_OUT_DIR || 'dist/assets',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: { output: { entryFileNames: 'app.js', assetFileNames: 'app.[ext]' } }
  }
});
