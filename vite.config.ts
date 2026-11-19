import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

/**
 * Локальная заглушка для /sdk.js только в dev-режиме,
 * чтобы браузер не выдавал ошибку синтаксиса при отсутствии скрипта Яндекс Игр.
 * В финальную сборку (dist/) этот файл не попадает — на платформе его подставляют Яндекс Игры.
 */
function yandexSdkDevStubPlugin(): Plugin {
  return {
    name: 'yandex-sdk-dev-stub',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/sdk.js', (_req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.end('/* Local dev mode: Yandex Games SDK (/sdk.js) is only injected on Yandex Games hosting. */\n');
      });
    },
  };
}

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      tailwindcss(),
      yandexSdkDevStubPlugin(),
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(import.meta.dirname, 'dist');
          const srcAssets = path.resolve(import.meta.dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/phaser')) {
              return 'phaser';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
