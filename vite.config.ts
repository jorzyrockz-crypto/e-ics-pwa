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
      devOptions: { enabled: true, type: 'module', resolveTempFolder: ()=>resolve(projectDir,'dev-dist') },
      includeAssets: ['icons/eload-tracker-192.png', 'icons/eload-tracker-512.png'],
      manifest: {
        id: deploymentBase,
        lang: 'en-PH',
        name: 'E-LOAD Tracker — Loads, Cash & Tracking',
        short_name: 'E-LOAD Tracker',
        description: 'Track prepaid load, cash transactions, wallet balances, fees, and profit for your sari-sari store, even offline.',
        categories: ['business', 'finance', 'productivity'],
        theme_color: '#0f172a',
        background_color: '#f1f5f0',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: deploymentBase,
        scope: deploymentBase,
        icons: [
          { src: `${deploymentBase}icons/eload-tracker-192.png?v=2`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${deploymentBase}icons/eload-tracker-512.png?v=2`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: { host: '0.0.0.0', allowedHosts: true },
});
