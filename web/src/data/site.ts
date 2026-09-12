export const SITE = {
  url: 'https://openclaude.gitlawb.com',
  name: 'openclaude',
  title: 'openclaude — open-source coding agent CLI for any model',
  description:
    'Open-source coding agent that runs in your terminal and talks to any model: OpenAI, Gemini, Ollama, GitHub Models, and 200+ more. One install, every provider.',
  installCommand:
    'curl -fsSL -o openclaude.tgz https://github.com/eltonacosta/orbit-code/releases/latest/download/openclaude-latest.tgz && npm install -g ./openclaude.tgz',
  github: 'https://github.com/eltonacosta/orbit-code',
  releasesUrl: 'https://github.com/eltonacosta/orbit-code/releases',
  gitlawb: 'https://gitlawb.com',
  gitlawbRepo: 'https://gitlawb.com/node/repos/z6MkqDnb/openclaude',
  ogDefault: '/og/default.png',
  ogDocs: '/og/docs.png',
} as const
