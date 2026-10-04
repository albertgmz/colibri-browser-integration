import { defineConfig } from 'wxt';
import manifest from './manifest.base.json';
export default defineConfig({
  manifestVersion: 3,
  manifest: ({ browser }) => ({ ...manifest, manifest_version: undefined, version: '0.5.0',
    ...(browser === 'firefox' ? {} : { browser_specific_settings: undefined }),
  }),
});
