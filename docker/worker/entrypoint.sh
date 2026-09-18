#!/bin/sh
# O worker roda dentro do Docker, mas em desenvolvimento o Supabase local roda
# no host. Uma URL com 127.0.0.1/localhost aponta para o container errado e o
# worker reinicia antes de consumir a fila do agente.
#
# Em VPS e Supabase Cloud a URL tem host remoto e passa literal: este ajuste é
# estritamente para loopback, sem imprimir a connection string nem credenciais.
set -eu

case "${SUPABASE_DB_URL:-}" in
  *@127.0.0.1:*|*@localhost:*|*@\[::1\]:*)
    SUPABASE_DB_URL="$(printf '%s' "$SUPABASE_DB_URL" | sed \
      -e 's/@127\.0\.0\.1:/@host.docker.internal:/' \
      -e 's/@localhost:/@host.docker.internal:/' \
      -e 's/@\[::1\]:/@host.docker.internal:/')"
    export SUPABASE_DB_URL
    printf '%s\n' 'worker: banco local acessado pelo gateway do host Docker' >&2
    ;;
esac

exec "$@"
