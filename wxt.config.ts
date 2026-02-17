import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'xTil',
    description: 'Extract content, distill knowledge. AI-powered summaries of any page or video with image analysis, diagrams, chat and Notion export.',
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
    permissions: ['activeTab', 'storage', 'scripting', 'tabs'],
    optional_permissions: ['sidePanel'],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      { resources: ['sidepanel.html'], matches: ['<all_urls>'] },
    ],
  },
  hooks: {
    // WXT auto-adds 'sidePanel' to required permissions when it detects a sidepanel entrypoint.
    // Move it to optional so the extension can install on browsers that don't support side panels
    // (e.g. Kiwi, Yandex mobile). The side_panel manifest key is kept — browsers that don't
    // support it simply ignore it.
    'build:manifestGenerated'(_wxt, manifest) {
      const perms = manifest.permissions as string[] | undefined;
      if (perms) {
        const idx = perms.indexOf('sidePanel');
        if (idx !== -1) perms.splice(idx, 1);
      }
    },
  },
  vite: () => ({
    plugins: [preact()],
  }),
});
