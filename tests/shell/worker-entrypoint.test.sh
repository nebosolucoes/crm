#!/usr/bin/env bash
# O worker local nasce em Docker, mas o Supabase local expõe Postgres no host.
# Esta prova executa o entrypoint real, sem abrir .env nem imprimir connection
# strings, para garantir que só o host de loopback é adaptado.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

ENTRYPOINT="docker/worker/entrypoint.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/mostrar-url.sh" <<'EOF'
#!/bin/sh
printf '%s' "${SUPABASE_DB_URL:-}"
EOF
chmod +x "$TMP/mostrar-url.sh"

falhas=0
check() {
  local nome="$1" esperado="$2" url="$3"
  local recebido
  recebido="$(SUPABASE_DB_URL="$url" sh "$ENTRYPOINT" "$TMP/mostrar-url.sh" 2>/dev/null)"
  if [ "$recebido" = "$esperado" ]; then
    printf '  ✓ %s\n' "$nome"
  else
    printf '  ✗ %s\n' "$nome"
    falhas=1
  fi
}

echo 'worker: URL local alcança o host sem vazar credenciais'
check \
  '127.0.0.1 troca somente o host' \
  'postgresql://usuario:senha@host.docker.internal:54322/postgres?sslmode=disable' \
  'postgresql://usuario:senha@127.0.0.1:54322/postgres?sslmode=disable'
check \
  'URL remota permanece literal' \
  'postgresql://usuario:senha@db.exemplo.com:5432/postgres' \
  'postgresql://usuario:senha@db.exemplo.com:5432/postgres'

SAIDA="$(SUPABASE_DB_URL='postgresql://usuario:senha@127.0.0.1:54322/postgres' sh "$ENTRYPOINT" /bin/true 2>&1 >/dev/null)"
if [[ "$SAIDA" == *'usuario:senha'* ]]; then
  printf '  ✗ o entrypoint imprimiu a connection string\n'
  falhas=1
else
  printf '  ✓ o log não expõe a connection string\n'
fi

exit "$falhas"
