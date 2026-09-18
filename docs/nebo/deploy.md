# Nebo — deploy do fork na VPS

Este fork vive em **https://github.com/nebosolucoes/crm** (privado), branch `nebo-custom`.

## O remote deste clone (confira antes de confiar nesta seção)

```bash
git remote -v
```

**Há exatamente um: `origin` → `nebosolucoes/crm`.** Em 18/09/2026 os outros dois foram
removidos de propósito — `upstream` (`melgarafael/DeskcommCRM`) e `lucas`
(`lucasrenz/nebo_CRM`) —, para que nenhum `push` ou `fetch` distraído alcance repo que não
é nosso. Antes de remover foi medido que nenhum dos dois guardava commit que a
`nebo-custom` já não tivesse.

⚠️ **Não existe remote `nebo`.** Este documento dizia `git push nebo nebo-custom` e dizia
que `origin` era o upstream — as duas coisas estavam invertidas, e quem seguisse ao pé da
letra levava `error: does not appear to be a git repository` no meio de um deploy.

## O ciclo (nada é automático)

```
1. git push origin nebo-custom
2. GitHub › Actions › "Publicar imagem Docker (GHCR)" › Run workflow › branch nebo-custom   (~5-8 min)
3. GitHub › Actions › "Deploy na VPS (fork)" › Run workflow
```

O passo 2 publica `ghcr.io/nebosolucoes/{deskcommcrm,deskcomm-worker,deskcomm-scheduler}:nebo-custom`.
O passo 3 entra na VPS por SSH e roda `scripts/deploy-nebo.sh` — o mesmo que dá para rodar à mão:

```bash
ssh usuario@vps 'cd deskcommcrm && bash scripts/deploy-nebo.sh'
```

**O botão do passo 3 só funciona com os quatro secrets cadastrados** (seção abaixo). Sem eles o
job falha no primeiro step; enquanto isso, o `ssh` acima faz exatamente a mesma coisa.

O script recusa subir quando: o `.env` da VPS não aponta para `ghcr.io/nebosolucoes`; o clone
na VPS tem mudança local; ou a imagem no GHCR não é do commit que está na branch (o passo 2
ainda não terminou). `--force` passa por cima do último.

**Não use `hostgator-setup-kit/update.sh`** neste fork: ele faz checkout da maior tag `v*` e
grava no `.env` as imagens de `ghcr.io/melgarafael` — as do upstream, sem as customizações.

## Configuração feita uma vez

### No repositório (Settings)
- Actions › General › *Workflow permissions* = **Read and write** (o push para o GHCR precisa de `packages: write`).
- Secrets and variables › Actions: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (chave privada ed25519;
  a pública vai no `~/.ssh/authorized_keys` da VPS), `VPS_PORT` se não for 22.

### Na VPS
```bash
REPO_URL=https://github.com/nebosolucoes/crm.git bash install.sh   # repo privado: o clone pede login
cd deskcommcrm && git checkout nebo-custom
docker login ghcr.io -u <usuario-github>    # token com read:packages — os pacotes são privados
```
E no `.env`:
```
APP_IMAGE=ghcr.io/nebosolucoes/deskcommcrm:nebo-custom
WORKER_IMAGE=ghcr.io/nebosolucoes/deskcomm-worker:nebo-custom
SCHEDULER_IMAGE=ghcr.io/nebosolucoes/deskcomm-scheduler:nebo-custom
APP_PULL_POLICY=always
```

### Telemetria: confira o `.env` da VPS uma vez

Até 18/09/2026 o código trazia o DSN do Sentry **do upstream** como fallback, e `SENTRY_DSN`
vazio mandava os erros de produção desta instalação para a caixa dele. Hoje vazio significa
telemetria desligada (`lib/sentry/dsn.ts`), mas **a imagem que está rodando na VPS agora ainda
é a antiga** — até o próximo deploy, o comportamento antigo vale. Para conferir e fechar já:

```bash
ssh usuario@vps 'cd deskcommcrm && grep -n "^SENTRY_DSN=" .env'
```

Se a linha estiver vazia ou ausente, ponha `SENTRY_DSN=off` e reinicie — não precisa esperar
o deploy. Depois do próximo deploy a linha pode voltar a ficar vazia sem consequência.

## Trazer atualizações do projeto de origem

O remote `upstream` **não existe mais neste clone** (seção acima). Isso é deliberado: puxar
do projeto de origem virou um ato consciente, de três comandos, em vez de um `git fetch`
distraído. Quando de fato quiser trazer:

```bash
git remote add upstream https://github.com/melgarafael/DeskcommCRM.git
git fetch upstream && git merge upstream/main     # resolve conflito se houver
git remote remove upstream                        # some de novo quando terminar

git push origin nebo-custom                       # depois: os dois botões
```

Antes de fazer o merge, leia os dois conflitos abaixo — eles reaparecem toda vez.

⚠️ **Dois conflitos deste fork que NÃO devem ser resolvidos pelo lado do upstream:**

- `lib/sentry/dsn.ts` — `DEFAULT_SENTRY_DSN` é `undefined` aqui. Vigiado por
  `tests/unit/sentry-comunidade-so-erro.test.ts`, que reprova o DSN literal voltando.
- `docs/nebo/*` — só existe deste lado; o upstream não tem o que dizer sobre eles.

Toda mudança de banco segue a doutrina do upstream (migration + apêndice no `baseline.sql` +
MANIFEST) — o `deploy-nebo.sh` reaplica o `baseline.sql`, então o que não estiver lá não chega à VPS.

## Credenciais

O token pessoal do GitHub (PAT) fica em `.env.local` (`NEBO_GITHUB_PAT`), que o git ignora.
**Nunca commitar**: arquivo versionado vai para o GitHub e o secret scanning revoga o token.
