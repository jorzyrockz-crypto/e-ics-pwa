import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

const projectDir=process.cwd();
const repositoryName=process.env.GITHUB_REPOSITORY?.split('/')[1] || 'eload-tracker';
const deploymentBase=process.env.GITHUB_ACTIONS ? `/${repositoryName}/` : '/';

export default defineConfig({
  base: deploymentBase,
  root: 'app',
  publicDir: '../public',
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      // Control a first-time visitor after installation too. Updates still wait
      // for Update now; claiming a client does not itself reload the page.
      workbox: { clientsClaim: true },
      devOptions: { enabled: true, type: 'module', resolveTempFolder: ()=>resolve(projectDir,'dev-dist') },
      includeAssets: [
        'favicon.ico',
        'icons/favicon.svg',
        'icons/favicon-16.png',
        'icons/favicon-32.png',
        'icons/eload-tracker-touch-180.png',
        'icons/eload-tracker-monochrome.svg',
        // All customer portraits must remain available even on offline-first use.
        'avatars/*.webp',
      ],
      manifest: {
        id: deploymentBase,
        lang: 'en-PH',
        name: 'E-LOAD Tracker — Loads, Cash & Tracking',
        short_name: 'E-LOAD Tracker',
        description: 'Track prepaid load, cash transactions, wallet balances, fees, and profit for your sari-sari store, even offline.',
        categories: ['business', 'finance', 'productivity'],
        theme_color: '#f1f5f0',
        background_color: '#f1f5f0',
        display: 'standalone',
        orientation: 'any',
        start_url: deploymentBase,
        scope: deploymentBase,
        icons: [
          { src: `${deploymentBase}icons/eload-tracker-192.png?v=3`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${deploymentBase}icons/eload-tracker-512.png?v=3`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${deploymentBase}icons/eload-tracker-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: `${deploymentBase}icons/eload-tracker-monochrome.svg`, sizes: '512x512', type: 'image/svg+xml', purpose: 'monochrome' },
        ],
      },
    }),
  ],
  server: { host: '0.0.0.0', allowedHosts: true },
});
