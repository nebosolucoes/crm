# Nebo — deploy do fork na VPS

Este fork vive em **https://github.com/nebosolucoes/crm** (privado), branch `nebo-custom`.
O upstream (`melgarafael/DeskcommCRM`) continua como remote `origin` para trazer atualizações.

## O ciclo (nada é automático)

```
1. git push nebo nebo-custom
2. GitHub › Actions › "Publicar imagem Docker (GHCR)" › Run workflow › branch nebo-custom   (~5-8 min)
3. GitHub › Actions › "Deploy na VPS (fork)" › Run workflow
```

O passo 2 publica `ghcr.io/nebosolucoes/{deskcommcrm,deskcomm-worker,deskcomm-scheduler}:nebo-custom`.
O passo 3 entra na VPS por SSH e roda `scripts/deploy-nebo.sh` — o mesmo que dá para rodar à mão:

```bash
ssh usuario@vps 'cd deskcommcrm && bash scripts/deploy-nebo.sh'
```

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

## Trazer atualizações do upstream

```bash
git fetch origin && git merge origin/main     # resolve conflito se houver
git push nebo nebo-custom                     # depois: os dois botões
```

Toda mudança de banco segue a doutrina do upstream (migration + apêndice no `baseline.sql` +
MANIFEST) — o `deploy-nebo.sh` reaplica o `baseline.sql`, então o que não estiver lá não chega à VPS.

## Credenciais

O token pessoal do GitHub (PAT) fica em `.env.local` (`NEBO_GITHUB_PAT`), que o git ignora.
**Nunca commitar**: arquivo versionado vai para o GitHub e o secret scanning revoga o token.
