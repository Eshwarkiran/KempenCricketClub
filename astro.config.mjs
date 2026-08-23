import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Kempen Cricket Club — static marketing site
export default defineConfig({
  site: 'https://kempencricket.be',
  integrations: [
    sitemap({
      // keep noindex/utility pages out of the sitemap
      filter: (page) => !/\/(404|thank-you|register|unsubscribe|add-member)\/$/.test(page),
    }),
  ],
  build: { format: 'directory' },
  trailingSlash: 'always',
});
