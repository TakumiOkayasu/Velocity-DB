import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: './', // Use relative paths for file:// protocol
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 600, // AG Grid is ~530KB, Monaco workers are large
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large vendor libraries into separate chunks
          'vendor-react': ['react', 'react-dom'],
          'vendor-monaco': ['monaco-editor', '@monaco-editor/react'],
          'vendor-ag-grid': ['ag-grid-community', 'ag-grid-react'],
          'vendor-reactflow': ['@xyflow/react'],
          'vendor-zustand': ['zustand'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
