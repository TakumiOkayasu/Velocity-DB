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
    minify: 'esbuild', // Explicitly use esbuild for faster minification
    target: 'es2020', // Modern target for faster builds and smaller output
    chunkSizeWarningLimit: 1000, // Large libraries like AG Grid v33 and Monaco exceed 600KB
    rollupOptions: {
      treeshake: {
        preset: 'recommended',
        moduleSideEffects: false,
      },
      output: {
        // Optimize chunk naming for better caching
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks(id) {
          // Split node_modules into vendor chunks
          if (id.includes('node_modules')) {
            // Monaco Editor - split into separate chunk (lazy loaded)
            if (id.includes('monaco-editor') || id.includes('@monaco-editor')) {
              return 'vendor-monaco';
            }
            // TanStack Table + Virtual - split into separate chunk (lazy loaded)
            if (id.includes('@tanstack/react-table') || id.includes('@tanstack/react-virtual')) {
              return 'vendor-table';
            }
            // React Flow - split into separate chunk (lazy loaded)
            if (id.includes('@xyflow') || id.includes('reactflow')) {
              return 'vendor-reactflow';
            }
            // React core (always loaded)
            if (id.includes('react-dom') || id.includes('/react/')) {
              return 'vendor-react';
            }
            // State management (always loaded)
            if (id.includes('zustand') || id.includes('immer')) {
              return 'vendor-state';
            }
          }
        },
      },
    },
  },
  esbuild: {
    logOverride: { 'this-is-undefined-in-esm': 'silent' },
    // Drop console and debugger in production
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  server: {
    port: 5173,
  },
  // Optimize dependencies pre-bundling
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand'],
    // Exclude lazy-loaded dependencies from pre-bundling
    exclude: ['@monaco-editor/react', '@tanstack/react-table', '@tanstack/react-virtual'],
  },
});
