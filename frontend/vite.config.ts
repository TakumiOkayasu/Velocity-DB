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
    chunkSizeWarningLimit: 1000, // Large libraries like AG Grid v33 and Monaco exceed 600KB
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Split node_modules into vendor chunks
          if (id.includes('node_modules')) {
            // AG Grid - split into separate chunk
            if (id.includes('ag-grid')) {
              return 'vendor-ag-grid';
            }
            // Monaco Editor - split into separate chunk
            if (id.includes('monaco-editor') || id.includes('@monaco-editor')) {
              return 'vendor-monaco';
            }
            // React Flow - split into separate chunk
            if (id.includes('@xyflow') || id.includes('reactflow')) {
              return 'vendor-reactflow';
            }
            // React core
            if (id.includes('react-dom') || id.includes('/react/')) {
              return 'vendor-react';
            }
            // Other smaller vendors
            if (id.includes('zustand') || id.includes('immer')) {
              return 'vendor-state';
            }
          }
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
