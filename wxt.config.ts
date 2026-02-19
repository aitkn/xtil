import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'xTil',
    description: 'Extract the signal, distill the insight. AI summaries of articles, videos, PRs & threads with diagrams, chat, and Notion export.',
    icons: {
      16: 'icons/icon-action.png',
      32: 'icons/icon-action.png',
      48: 'icons/icon-action.png',
      64: 'icons/icon-action.png',
      96: 'icons/icon-action.png',
      128: 'icons/icon-128.png',
      256: 'icons/icon-256.png',
    },
    action: {
      default_icon: {
        16: 'icons/icon-action.png',
        32: 'icons/icon-action.png',
        48: 'icons/icon-action.png',
        64: 'icons/icon-action.png',
        96: 'icons/icon-action.png',
        128: 'icons/icon-128.png',
        256: 'icons/icon-256.png',
      },
    },
    permissions: ['activeTab', 'storage', 'scripting', 'tabs', 'sidePanel'],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      { resources: ['sidepanel.html'], matches: ['<all_urls>'] },
    ],
  },
  vite: () => ({
    plugins: [preact()],
  }),
});
