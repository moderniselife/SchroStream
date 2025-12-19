import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'SchroStream',
  description: 'Discord Plex Streaming Self-Bot Documentation',
  base: '/SchroStream/',
  
  head: [
    ['link', { rel: 'icon', href: '/SchroStream/favicon.ico' }]
  ],

  themeConfig: {
    logo: '/logo.png',
    
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'GitHub', link: 'https://github.com/moderniselife/SchroStream' }
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is SchroStream?', link: '/guide/introduction' },
          { text: 'Getting Started', link: '/guide/getting-started' },
        ]
      },
      {
        text: 'Setup',
        items: [
          { text: 'Prerequisites', link: '/guide/prerequisites' },
          { text: 'Discord Token', link: '/guide/discord-token' },
          { text: 'Plex Token', link: '/guide/plex-token' },
          { text: 'Configuration', link: '/guide/configuration' },
        ]
      },
      {
        text: 'Deployment',
        items: [
          { text: 'Local Installation', link: '/guide/local-install' },
          { text: 'Docker', link: '/guide/docker' },
          { text: 'Docker Compose', link: '/guide/docker-compose' },
        ]
      },
      {
        text: 'Usage',
        items: [
          { text: 'Commands', link: '/guide/commands' },
          { text: 'Permissions', link: '/guide/permissions' },
          { text: 'Troubleshooting', link: '/guide/troubleshooting' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/moderniselife/SchroStream' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024 SchroStream'
    }
  }
})
