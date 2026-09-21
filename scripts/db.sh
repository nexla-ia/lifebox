#!/usr/bin/env bash
# LifeBox · banco de desenvolvimento
#
#   scripts/db.sh up      sobe o cluster local de teste
#   scripts/db.sh reset   recria o banco: stub + migrations + seed base + exemplo
#   scripts/db.sh test    roda os testes de preço, classificação e RLS
#   scripts/db.sh down    derruba o cluster
#
# Usa um cluster Postgres próprio, isolado, com auth trust — não encosta em
# nenhum banco existente da máquina. Para rodar contra o Supabase, exporte
# DATABASE_URL e use só `reset` / `test` (o stub é pulado automaticamente).

set -euo pipefail
cd "$(dirname "$0")/.."

# só usado pelo cluster local; com DATABASE_URL apontando para o Supabase este
# caminho nunca é tocado — mas com `set -u` ele precisa resolver mesmo assim.
PGDATA_DIR="${LIFEBOX_PGDATA:-${TMPDIR:-/tmp}/lifebox-pgdata}"
PORT="${LIFEBOX_PGPORT:-5440}"
LOCAL_URL="postgresql://postgres@localhost:$PORT/lifebox"
DB_URL="${DATABASE_URL:-$LOCAL_URL}"
IS_LOCAL=$([ "$DB_URL" = "$LOCAL_URL" ] && echo 1 || echo 0)

export PGCLIENTENCODING=UTF8
run() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q "$@"; }

case "${1:-}" in
  up)
    [ -d "$PGDATA_DIR" ] || initdb -U postgres -A trust -E UTF8 --locale=C "$PGDATA_DIR" >/dev/null
    pg_ctl -D "$PGDATA_DIR" -o "-p $PORT -c listen_addresses=localhost" \
           -l "$PGDATA_DIR/server.log" start >/dev/null 2>&1 || true
    sleep 2
    psql -h localhost -p "$PORT" -U postgres -d postgres -tAc "select 'cluster UP na porta $PORT'"
    ;;

  down)
    pg_ctl -D "$PGDATA_DIR" stop >/dev/null 2>&1 || true
    echo "cluster parado"
    ;;

  reset)
    if [ "$IS_LOCAL" = 1 ]; then
      psql -h localhost -p "$PORT" -U postgres -d postgres -qc \
        "drop database if exists lifebox" >/dev/null
      psql -h localhost -p "$PORT" -U postgres -d postgres -qc \
        "create database lifebox encoding 'UTF8' template template0" >/dev/null
      run -f supabase/tests/00_local_stub.sql
    fi
    for f in supabase/migrations/*.sql; do
      echo "  migration $(basename "$f")"; run -f "$f"
    done
    echo "  seed base"; run -f supabase/seed.sql
    if [ "${2:-}" != "--sem-exemplo" ]; then
      echo "  seed de exemplo (dev)"; run -f supabase/seeds/exemplo_catalogo.sql
    fi
    echo "banco pronto"
    ;;

  test)
    # Sem esta checagem, cluster parado devolve "0 falhas" e parece verde —
    # o pior tipo de resultado, porque nada rodou e ninguém percebe.
    if ! psql "$DB_URL" -tAc 'select 1' >/dev/null 2>&1; then
      echo "ERRO: não consegui conectar ao banco." >&2
      echo "      cluster local parado? rode: npm run db:up" >&2
      exit 1
    fi
    for t in pricing semanas pedidos bags link rls; do
      psql "$DB_URL" -v ON_ERROR_STOP=1 -f "supabase/tests/${t}_test.sql" 2>&1 \
        | grep -E 'NOTICE|ERROR|FALHOU' | sed 's/^psql:[^ ]* //; s/NOTICE:  //'
    done
    ;;

  *)
    sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
