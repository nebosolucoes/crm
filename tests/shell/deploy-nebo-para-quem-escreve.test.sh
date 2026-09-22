#!/usr/bin/env bash
# Prova de `scripts/deploy-nebo.sh`, com `docker` substituído por um dublê que
# registra cada chamada e devolve o que o roteiro mandar.
#
#   bash tests/shell/deploy-nebo-para-quem-escreve.test.sh
#
# O defeito, medido nesta VPS em 22/09/2026: o deploy reaplicou o baseline com o
# app, o worker e o scheduler atendendo. O `create trigger`/`create policy` do
# apendice pede ACCESS EXCLUSIVE, disputou lock com o trafego vivo e perdeu nas
# TRES passadas de `reaplicar_baseline` (`deadlock detected`, numa linha
# diferente a cada passada). O deploy parou, e o `drop policy` que commitou
# antes do `create` que nao commitou deixou `ai_reply_drafts` sem policy.
#
# O que esta sob prova:
#   1. os tres escritores sao PARADOS antes do baseline e o `up -d` so vem
#      depois dele — a ordem "derruba o velho, migra, sobe o novo";
#   2. baseline que nao cura => o script reprova E religa os tres, senao a
#      instalacao fica no chao;
#   3. o religar e `start`, NUNCA `up -d`: `up -d` recriaria na imagem NOVA, que
#      e app novo sobre banco pela metade — o que a recusa existe para impedir;
#   4. `stop` que falha no meio tambem religa (a marca e armada antes dele);
#   5. depois do `up -d` o trap esta desarmado: falha de saude nao religa nada
#      por cima do que ja subiu.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILS=0
check() {  # check <descricao> <comando de verificacao...>
  if "${@:2}"; then printf '  ✓ %s\n' "$1"; else printf '  ✗ %s\n' "$1"; FAILS=$((FAILS + 1)); fi
}

# ── Dubles de `docker` e `sleep` ─────────────────────────────────────────────
# O duble registra TUDO em $DOCKER_LOG (e a ordem do log e o que as provas de
# sequencia leem) e decide pela forma da chamada. `sleep` vira no-op para que as
# 20 tentativas de `wait_app_healthy` e a espera entre passadas nao custem tempo.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_LOG"
case " $* " in
  *" -f /b.sql "*)   # uma passada do baseline
    n=$(( $(cat "$ROTEIRO/n" 2>/dev/null || echo 0) + 1 ))
    printf '%s' "$n" > "$ROTEIRO/n"
    [ -f "$ROTEIRO/baseline.$n" ] && cat "$ROTEIRO/baseline.$n"
    exit 0 ;;
  *" stop "*)  exit "$(cat "$ROTEIRO/stop_rc" 2>/dev/null || echo 0)" ;;
  *" up "*)    exit "$(cat "$ROTEIRO/up_rc"   2>/dev/null || echo 0)" ;;
  *" exec "*)  cat "$ROTEIRO/health" 2>/dev/null || printf 'healthy\n{}\n'; exit 0 ;;
esac
exit 0
STUB
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/bin/sleep"
chmod +x "$WORK/bin/docker" "$WORK/bin/sleep"

# ── A arvore que o script espera encontrar ───────────────────────────────────
PROJ="$WORK/proj"
mkdir -p "$PROJ/scripts" "$PROJ/supabase"
cp -r "$RAIZ/hostgator-setup-kit" "$PROJ/hostgator-setup-kit"
cp "$RAIZ/scripts/deploy-nebo.sh" "$PROJ/scripts/deploy-nebo.sh"
printf 'services: {}\n' > "$PROJ/docker-compose.prod.yml"
printf 'select 1;\n'    > "$PROJ/supabase/baseline.sql"
printf '.env\n'         > "$PROJ/.gitignore"
cat > "$PROJ/.env" <<'ENV'
APP_IMAGE=ghcr.io/nebosolucoes/deskcommcrm:nebo-custom
WORKER_IMAGE=ghcr.io/nebosolucoes/deskcomm-worker:nebo-custom
SCHEDULER_IMAGE=ghcr.io/nebosolucoes/deskcomm-scheduler:nebo-custom
APP_PULL_POLICY=always
REVERSE_PROXY=caddy
SUPABASE_DB_URL=postgresql://postgres:x@db.exemplo:5432/postgres
ENV
# Repo de verdade (mais barato que dublar o git) com `origin` apontando para si:
# o fetch funciona e o `merge --ff-only` e um no-op, como numa VPS em dia.
git -C "$PROJ" init -q -b nebo-custom
# Sem isto o git avisa "LF will be replaced by CRLF" para cada arquivo
# copiado quando o clone de quem roda esta no Windows — ruido, nao defeito.
git -C "$PROJ" config core.autocrlf false
git -C "$PROJ" -c user.email=t@t -c user.name=t add -A
git -C "$PROJ" -c user.email=t@t -c user.name=t commit -qm "arvore de teste"
git -C "$PROJ" remote add origin "$PROJ"
git -C "$PROJ" fetch -q origin nebo-custom

DEADLOCK='psql:/b.sql:21598: ERROR:  deadlock detected
DETAIL:  Process 4121 waits for AccessExclusiveLock on relation 29187 of database 5.'

novo_caso() {
  ROTEIRO="$WORK/roteiro.$1"
  rm -rf "$ROTEIRO"; mkdir -p "$ROTEIRO"
  : > "$WORK/docker.log"
}

# rodar → codigo de saida em $RC, chamadas de docker em $WORK/docker.log
rodar() {
  PATH="$WORK/bin:$PATH" DOCKER_LOG="$WORK/docker.log" ROTEIRO="$ROTEIRO" \
  BASELINE_ESPERA_S=0 \
    bash "$PROJ/scripts/deploy-nebo.sh" --skip-backup > "$WORK/tela.log" 2>&1
  RC=$?
}

# Numero da linha do log em que <padrao> aparece (0 = nao apareceu).
linha_de() { grep -nF -m1 -- "$1" "$WORK/docker.log" | cut -d: -f1 || true; }
tem()      { grep -qF -- "$1" "$WORK/docker.log"; }
nao_tem()  { ! grep -qF -- "$1" "$WORK/docker.log"; }

printf '\n1. Caminho feliz: para, migra, sobe\n'
novo_caso feliz
rodar
check "o deploy passa (saida 0)" test "$RC" -eq 0
check "parou app, worker e scheduler"   tem "stop app worker scheduler"
check "o baseline foi aplicado"         tem "-f /b.sql"
check "o stop veio ANTES do baseline"   test "$(linha_de 'stop app worker scheduler')" -lt "$(linha_de '-f /b.sql')"
check "o up -d veio DEPOIS do baseline" test "$(linha_de '-f /b.sql')" -lt "$(linha_de 'docker-compose.prod.yml up -d')"
check "nao religou por cima (trap desarmado)" nao_tem "start app worker scheduler"

printf '\n2. Baseline que nao cura: reprova e devolve a instalacao ao ar\n'
novo_caso disputa
for n in 1 2 3; do printf '%s\n' "$DEADLOCK" > "$ROTEIRO/baseline.$n"; done
rodar
check "o deploy reprova (saida 1)"       test "$RC" -eq 1
check "religou os tres"                  tem "start app worker scheduler"
check "religou com start, NAO com up -d" nao_tem "docker-compose.prod.yml up -d"
check "nao subiu app novo sobre banco pela metade" grep -q "Banco incompleto" "$WORK/tela.log"

printf '\n3. `stop` que falha no meio tambem religa\n'
novo_caso stop_falhou
printf '1' > "$ROTEIRO/stop_rc"
rodar
check "o deploy reprova (saida 1)" test "$RC" -eq 1
check "religou mesmo assim"        tem "start app worker scheduler"
check "nem chegou no baseline"     nao_tem "-f /b.sql"

printf '\n4. Falha de saude depois do up -d nao religa nada\n'
novo_caso saude
printf 'sem_status\n{}\n' > "$ROTEIRO/health"
rodar
check "o deploy reprova (saida 1)"        test "$RC" -eq 1
check "o up -d aconteceu"                 tem "docker-compose.prod.yml up -d"
check "o trap ja estava desarmado"        nao_tem "start app worker scheduler"

printf '\n'
if [ "$FAILS" -eq 0 ]; then printf '✓ tudo passou\n'; else printf '✗ %s falha(s)\n' "$FAILS"; fi
exit $(( FAILS > 0 ))
