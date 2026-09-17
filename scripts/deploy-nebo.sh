#!/usr/bin/env bash
# Deploy do FORK (branch `nebo-custom`) na VPS. Roda NA VPS, dentro da pasta do
# projeto (a mesma que o install.sh criou):
#
#   bash scripts/deploy-nebo.sh
#
# Flags:
#   --skip-backup  pula o backup automático (não recomendado)
#   --force        sobe mesmo que a imagem no GHCR não seja do commit que está
#                  no disco (quando o "Publicar imagem Docker" ainda não terminou)
#
# Por que não é o update.sh: ele faz checkout da maior tag `v*` e grava no .env
# as imagens de `ghcr.io/melgarafael` — as do UPSTREAM. Este script segue a
# branch do fork e as imagens que o `.env` já aponta (ghcr.io/lucasrenz/...),
# reaproveitando as mesmas funções do kit (backup, baseline, proxy, saúde).
#
# Ciclo completo: push na `nebo-custom` → Actions › "Publicar imagem Docker
# (GHCR)" › Run workflow → Actions › "Deploy na VPS (fork)" › Run workflow
# (ou este script à mão por SSH).

BRANCH="${DEPLOY_BRANCH:-nebo-custom}"
NS_DO_FORK="${DEPLOY_IMG_NS:-ghcr.io/lucasrenz}"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
source "$RAIZ/hostgator-setup-kit/_common.sh"
cd "$RAIZ"
enter_project

SKIP_BACKUP=""; FORCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-backup) SKIP_BACKUP=1 ;;
    --force) FORCE=1 ;;
  esac
  shift
done

recusar_projeto_de_outra_arvore || die "Deploy interrompido para não quebrar a instalação que está no ar."

# ── 0. O .env aponta para as imagens do fork? ────────────────────────────────
# Sem isto o `pull` traz o app do upstream e o deploy "funciona" sem uma linha
# das customizações — o modo de falha mais silencioso deste caminho.
step "Conferindo para onde o .env aponta"
for par in "APP_IMAGE:${APP_IMAGE:-}" "WORKER_IMAGE:${WORKER_IMAGE:-}" "SCHEDULER_IMAGE:${SCHEDULER_IMAGE:-}"; do
  chave="${par%%:*}"; valor="${par#*:}"
  case "$valor" in
    "$NS_DO_FORK"/*) c_grn "✓ $chave=$valor" ;;
    "") die "$chave não está no .env. Grave as três *_IMAGE apontando para $NS_DO_FORK/... (ver o cabeçalho deste script)." ;;
    *) die "$chave=$valor não é do fork ($NS_DO_FORK). O deploy subiria o app do upstream, sem as customizações." ;;
  esac
done
[ "${APP_PULL_POLICY:-always}" = "always" ] \
  || c_ylw "⚠ APP_PULL_POLICY=${APP_PULL_POLICY} — com tag móvel (${APP_IMAGE##*:}) o certo é 'always', senão o pull não traz a imagem nova."

# ── 1. Código: baseline.sql e kit novos ──────────────────────────────────────
step "Atualizando o código ($BRANCH)"
git fetch --quiet origin "$BRANCH" || die "Não consegui falar com o GitHub."
atual="$(git rev-parse --abbrev-ref HEAD)"
[ "$atual" = "$BRANCH" ] || die "Este clone está em '$atual', não em '$BRANCH'. Rode: git checkout $BRANCH"
[ -z "$(git status --porcelain)" ] || die "Há mudanças locais neste clone. O deploy só entra em árvore limpa (git status)."
git merge --ff-only --quiet "origin/$BRANCH" || die "A branch local divergiu de origin/$BRANCH — resolva à mão."
SHA_CODIGO="$(git rev-parse HEAD)"
c_grn "✓ código em ${SHA_CODIGO:0:7} ($(git log -1 --format=%s | cut -c1-70))"

# ── 2. Backup antes de tocar no banco ────────────────────────────────────────
if [ -z "$SKIP_BACKUP" ]; then
  step "Backup de segurança (antes de mexer no banco)"
  bash hostgator-setup-kit/backup.sh || die "O backup falhou. Deploy interrompido para proteger os dados (ou rode com --skip-backup)."
  c_grn "✓ backup feito — se algo der errado: bash hostgator-setup-kit/restore.sh"
fi

# ── 3. Imagens: puxar e conferir que são deste commit ────────────────────────
# A imagem carrega `org.opencontainers.image.revision` = SHA que o CI buildou.
# Se ele não bate com o HEAD daqui, o "Publicar" ainda não terminou (ou falhou)
# e o que está no GHCR é o deploy anterior.
step "Puxando as imagens do fork"
dc pull app worker scheduler || die "Não consegui puxar as imagens. Pacote privado no GHCR? Faça 'docker login ghcr.io' nesta VPS com um token read:packages."
SHA_IMAGEM="$(docker image inspect "$APP_IMAGE" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true)"
if [ -n "$SHA_IMAGEM" ] && [ "$SHA_IMAGEM" != "$SHA_CODIGO" ]; then
  c_ylw "⚠ A imagem do app é do commit ${SHA_IMAGEM:0:7}; o código no disco é ${SHA_CODIGO:0:7}."
  if [ -z "$FORCE" ]; then
    die "O 'Publicar imagem Docker' desse commit ainda não terminou (ou falhou). Espere-o ficar verde e rode de novo — ou --force para subir a imagem que existe."
  fi
  c_ylw "  Seguindo por --force: banco na versão do disco, app na versão da imagem."
else
  c_grn "✓ imagem do app corresponde ao código (${SHA_CODIGO:0:7})"
fi

# ── 4. Banco: reaplicar o baseline (idempotente; é o que o update.sh faz) ────
step "Atualizando o banco (baseline.sql)"
docker run --rm postgres:17-alpine psql "$(url_do_schema)" -c \
  "create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;" \
  >/dev/null 2>&1 || true
if reaplicar_baseline "$PROJECT_DIR/supabase/baseline.sql"; then
  c_grn "✓ banco atualizado"
else
  c_ylw "⚠ Apareceram avisos no banco que NÃO são os esperados:"
  listar_erros_do_banco "$BASELINE_INESPERADO" 20
  die "Banco incompleto — não subo app novo sobre banco pela metade. Restaure com restore.sh ou investigue e rode de novo."
fi

# ── 5. Subir ─────────────────────────────────────────────────────────────────
step "Subindo os contêineres"
garantir_rede_do_proxy
dc up -d
# Caddyfile entra por bind mount de arquivo (preso ao inode): sem recriar, uma
# mudança de proxy que veio no git pull não vale. Com proxy externo não há Caddy.
case "${REVERSE_PROXY:-caddy}" in
  traefik|npm) c_grn "✓ proxy externo (${REVERSE_PROXY}) — nada a recarregar" ;;
  *) dc up -d --force-recreate --no-deps caddy >/dev/null 2>&1 \
       && c_grn "✓ proxy recarregado" \
       || c_ylw "⚠ não consegui recriar o proxy — rode: docker compose $(dc_files) up -d --force-recreate caddy" ;;
esac

# ── 6. Voltou no ar? ─────────────────────────────────────────────────────────
step "Conferindo se o app voltou no ar"
if wait_app_healthy 20 3 >/dev/null; then
  c_grn "✓ app no ar — commit ${SHA_CODIGO:0:7}"
else
  c_red "✖ o app não respondeu saudável em 60s. Logs: docker compose $(dc_files) logs --tail=80 app"
  exit 1
fi
if [ -n "${DOMAIN:-}" ]; then
  code="$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "https://${DOMAIN}/" || echo 000)"
  case "$code" in
    307|200) c_grn "✓ https://${DOMAIN}/ respondeu $code" ;;
    404) c_red "✖ https://${DOMAIN}/ respondeu 404 — o proxy não enxerga o app (REVERSE_PROXY=${REVERSE_PROXY:-caddy}). Ver docs/runbooks/deploy.md §2." ; exit 1 ;;
    *) c_ylw "⚠ https://${DOMAIN}/ respondeu $code — confira no navegador." ;;
  esac
fi
