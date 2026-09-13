# Orbit Code

Orbit Code é um CLI de agente de codificação open-source para provedores de modelo em nuvem e locais. Um workflow de terminal: prompts, ferramentas, agentes, MCP, slash commands e streaming — com OpenAI-compatible APIs, Gemini, DeepSeek, Ollama, e 200+ modelos.

Este repositório é um fork do OpenClaude com integração ao **Orbit Router** (roteamento inteligente de modelos) e persistência global dos modelos entre sessões. `openclaude` segue como nome do pacote, binário compatível e diretório de config (`~/.openclaude/`); **Orbit Code** é a marca da interface.

## Requisitos

- Node.js `>= 22.0.0`
- Bun `1.3.13+` (apenas para instalação a partir do fonte / git)

## Instalação

### Via GitHub Releases (1 comando)

Cada release publica o pacote instalável `openclaude-<versão>.tgz` como asset permanente na página [Releases](https://github.com/eltonacosta/orbit-code/releases), validado em Linux/macOS/Windows e em Node 22/24 (workflow **Auto Release**). Baixe o `.tgz` da release mais recente, abra o terminal na pasta do download e instale passando o caminho do arquivo:

```bash
# abra o terminal na pasta onde o arquivo foi baixado
npm install -g ./openclaude-0.33.5.tgz
```

No Windows (PowerShell/CMD) o equivalente é `npm install -g .\openclaude-0.33.5.tgz`.

Ou, sem baixar manualmente (macOS/Linux) — o asset `openclaude-latest.tgz` aponta sempre para a release mais recente:

```bash
curl -fsSL -o openclaude.tgz https://github.com/eltonacosta/orbit-code/releases/latest/download/openclaude-latest.tgz
npm install -g ./openclaude.tgz
```

### Como funciona a versão (tags automáticas)

1. A versão é escolhida por você no `package.json` (`"version": "0.33.5"`).
2. Ao dar push/merge em `main`, o CI detecta que a versão mudou para uma ainda não publicada.
3. Ele valida que é um `X.Y.Z` estrito e **maior** que a última tag (`vX.Y.Z` nunca se repete).
4. Só depois de buildar e validar o `.tgz` em todos os OS ele cria a tag `vX.Y.Z` e a release — as tags ficam da mais recente para a mais antiga na página Releases.
5. Se a versão não mudou (ou já foi lançada), o push em `main` apenas passa pelo CI normal, sem tag nova.

Para lançar uma nova versão: **bump no `package.json` + push em `main`**. Nada de npm: o GitHub Releases é o único ponto de distribuição.

### Via fonte (desenvolvimento)

```bash
git clone https://github.com/eltonacosta/orbit-code.git
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
/login http://localhost:8080/v1 sk-sua-chave
```

O que acontece:

1. Salva as credenciais de forma global (`~/.openclaude.json`)
2. Descobre automaticamente os modelos disponíveis em `/v1/models`
3. Enriquece os modelos com metadados (contexto, tool-use, reasoning)
4. Define `oc/...` como modelo ativo

Os modelos ficam **persistidos em cache global** (`~/.openclaude/models-cache.json`). Ao fechar e reabrir o CLI, os modelos já estão carregados — sem precisar rodar `/discovery` de novo. Rode `/discovery` quando quiser atualizar a lista.

### Painel no celular (`oc serve`)

Gerencie o projeto pelo navegador do celular, na rede local:

```bash
oc serve
```

1. Na primeira execução, crie a senha do painel (mínimo 8 caracteres, guardada com hash em `~/.openclaude/panel.json`).
2. O terminal mostra as URLs de acesso e um QR code — escaneie com o celular (mesmo Wi-Fi).
3. No painel você lista tarefas em segundo plano, vê logs stdout/stderr, inicia novas tarefas e encerra as que terminaram.

O painel funciona somente na rede local. Opções: `--port 3100`, `--host 0.0.0.0` (use `--host 127.0.0.1` para bloquear a rede local), `--password <senha>` (modo não interativo).

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
- `src/entrypoints/` — CLI, MCP, SDK
- `src/integrations/` — metadados de provedores e modelos
- `src/tasks/` — tarefas locais, remotas e monitoramento
- `src/panel/` — painel mobile (`oc serve`): HTTP + página de controle na rede local
- `docs/` — documentação (mapa em [docs/repo-map.md](docs/repo-map.md))

## Licença

MIT para as modificações dos contribuidores do OpenClaude; o Claude Code derivado permanece da Anthropic. Veja [LICENSE](LICENSE).

---

OpenClaude é um projeto comunitário independente, não afiliado, endossado ou patrocinado pela Anthropic. "Claude" e "Claude Code" são marcas registradas da Anthropic PBC.