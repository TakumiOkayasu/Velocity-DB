import path from 'node:path';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type Plugin, type PluginOption } from 'vite';

/**
 * Prevents Vite from bundling unused Monaco language workers (css, html, json, typescript).
 * Only the base editor.worker is needed for SQL editing.
 * Runs before vite:worker-import-meta-url to remove the `new Worker(new URL(...))` pattern.
 */
function monacoWorkerExcludePlugin(): Plugin {
  const workerManagerRE =
    /monaco-editor[\\/]esm[\\/]vs[\\/]languages[\\/]features[\\/](css|html|json|typescript)[\\/]workerManager\.js$/;
  return {
    name: 'monaco-worker-exclude',
    enforce: 'pre',
    transform(code, id) {
      if (!workerManagerRE.test(id)) return null;
      const transformed = code.replace(
        /new Worker\(new URL\('[^']+\.worker\.js',\s*import\.meta\.url\),\s*\{[^}]*\}\)/g,
        '(() => { throw new Error("Worker not available"); })()'
      );
      if (transformed !== code) return { code: transformed, map: null };
      return null;
    },
  };
}

const BUNDLE_REPORT_ENABLED = process.env.VELOCITYDB_BUNDLE_REPORT === '1';

export default defineConfig({
  plugins: [
    react(),
    monacoWorkerExcludePlugin(),
    ...(BUNDLE_REPORT_ENABLED
      ? [
          visualizer({
            filename: 'dist/bundle-report.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
            sourcemap: true,
          }) as PluginOption,
        ]
      : []),
  ],
  base: './', // Use relative paths for file:// protocol
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  css: {
    transformer: 'lightningcss',
    lightningcss: {
      // WebView2 targets Chromium 120+. lightningcss encodes versions as (major << 16 | minor << 8 | patch).
      targets: { chrome: 120 << 16 },
    },
  },
  build: {
    cssCodeSplit: false, // WebView2仮想ホストでのCSSプリロード失敗を防止
    outDir: 'dist',
    sourcemap: 'hidden',
    cssMinify: 'lightningcss',
    minify: 'oxc',
    target: 'es2020',
    chunkSizeWarningLimit: 5000, // Monaco Editor vendor chunk is ~4.3MB
    rolldownOptions: {
      output: {
        // Optimize chunk naming for better caching
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        minify: {
          compress: {
            dropConsole: true,
            dropDebugger: true,
          },
          mangle: true,
        },
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
            // SQL Formatter (lazy loaded via dynamic import)
            if (id.includes('@sqltools/formatter')) {
              return 'vendor-sqltools-formatter';
            }
          }
        },
      },
    },
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
