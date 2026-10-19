import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// SITE and BASE are set by the docs workflow for GitHub Pages.
export default defineConfig({
  site: process.env.SITE,
  base: process.env.BASE,
  integrations: [
    starlight({
      title: 'openrouter-langfuse-agent-ts',
    }),
  ],
});
