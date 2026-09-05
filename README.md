# OpenClaude

OpenClaude é um CLI de agente de codificação open-source para provedores de modelo em nuvem e locais. Um workflow de terminal: prompts, ferramentas, agentes, MCP, slash commands e streaming — com OpenAI-compatible APIs, Gemini, DeepSeek, Ollama, e 200+ modelos.

Este repositório é um fork com integração ao **Orbit Router** (roteamento inteligente de modelos) e persistência global dos modelos entre sessões.

## Requisitos

- Node.js `>= 22.0.0`
- Bun `1.3.13+` (apenas para instalação a partir do fonte / git)

## Instalação

### Via artifact do GitHub (1 comando)

O CI gera o pacote instalável `.tgz` (workflow **Package artifact**), validado em Linux/macOS/Windows. Baixe o `openclaude-<versão>.tgz` na aba **Actions** do repositório e instale:

```bash
npm install -g openclaude-<versão>.tgz
```

### Via fonte (desenvolvimento)

```bash
git clone https://github.com/eltonacosta/openclaude.git
cd openclaude
bun install
bun run build
node dist/cli.mjs
```

## Quick Start

```bash
openclaude
```

Dentro do CLI:

- `/provider` — setup guiado de provedores e perfis salvos
- `/model` — listar e alternar modelos registrados
- `/discovery` — descobrir e sincronizar modelos do roteador configurado
- `/help` — lista de comandos

### Orbit Router (fork)

Configure seu roteador com um único comando:

```bash
/login https://ai.servhub.xyz/v1 sk-sua-chave
```

O que acontece:

1. Salva as credenciais de forma global (`~/.openclaude.json`)
2. Descobre automaticamente os modelos disponíveis em `/v1/models`
3. Enriquece os modelos com metadados (contexto, tool-use, reasoning)
4. Define `oc/...` como modelo ativo

Os modelos ficam **persistidos em cache global** (`~/.openclaude/models-cache.json`). Ao fechar e reabrir o CLI, os modelos já estão carregados — sem precisar rodar `/discovery` de novo. Rode `/discovery` quando quiser atualizar a lista.

## Desenvolvimento

```bash
bun install
bun run dev        # build + launch a partir do fonte
bun test           # suíte de testes
bun run smoke      # smoke checks
bun run typecheck  # typecheck
```

Antes de abrir ou atualizar um PR, siga o contrato de validação em [CONTRIBUTING.md](CONTRIBUTING.md#validation).

## Estrutura

- `src/commands/` — comandos slash e CLI
- `src/services/` — integrações de API, MCP, OAuth
- `src/components/` — UI React/Ink
- `src/utils/` — utilitários compartilhados
- `docs/` — documentação

## Licença

MIT para as modificações dos contribuidores do OpenClaude; o Claude Code derivado permanece da Anthropic. Veja [LICENSE](LICENSE).

---

OpenClaude é um projeto comunitário independente, não afiliado, endossado ou patrocinado pela Anthropic. "Claude" e "Claude Code" são marcas registradas da Anthropic PBC.