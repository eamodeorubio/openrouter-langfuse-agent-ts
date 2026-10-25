import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// SITE and BASE are set by the docs workflow for GitHub Pages.
export default defineConfig({
  site: process.env.SITE,
  base: process.env.BASE,
  integrations: [
    starlight({
      title: 'ask-openrouter',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/eamodeorubio/openrouter-langfuse-agent-ts',
        },
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Overview', slug: '' },
            'install',
            'set-up',
            'ask-a-question',
            'troubleshooting',
          ],
        },
        {
          label: 'Reference',
          items: ['command-line', 'tools', 'tracing', 'json-output'],
        },
        {
          label: 'Contributing',
          items: ['how-changes-are-made'],
        },
      ],
    }),
  ],
});
