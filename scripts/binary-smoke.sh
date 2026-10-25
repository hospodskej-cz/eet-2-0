#!/usr/bin/env bash
# Runs a compiled `eet` binary through its commands with the shared playground certificate.
# Sends nothing to EET. Usage: scripts/binary-smoke.sh dist/bin/eet-<target>
# (needs .cache/playground: bun run certs:playground)
set -euo pipefail
bin="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cache="$(pwd)/.cache/playground"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail() { echo "FAIL $*"; exit 1; }

cp "$cache/CA_EET-Playground-CZ00000019.p12" "$work/kasa.p12"
cp "$cache/password_pokladni_cert_playground.txt" "$work/kasa.password"
cat > "$work/eet.config.yaml" <<YAML
apiKeys: [binary-smoke-key-0123456789]
database: ./data/queue.db
registers:
  kasa-1:
    environment: playground
    certificates: [{ p12: ./kasa.p12, passwordFile: ./kasa.password }]
    defaults: { id_jednotky: 11, id_pokl: KASA-1 }
YAML
printf 'porad_cis;dat_trzby;celk_trzba\nB-1;25.10.2026 18:00;12,50\n' > "$work/sales.csv"
cd "$work"

"$bin" --version | grep -q '^eet ' || fail "--version"
echo "ok --version: $("$bin" --version)"
"$bin" cert inspect kasa.p12 --password-file kasa.password | grep -q 'EIČ: *CZ00000019' || fail "cert inspect"
echo "ok cert inspect"
"$bin" validate sales.csv | grep -q 'platná .*pokladna kasa-1' || fail "validate"
echo "ok validate (config from the working directory)"
"$bin" queue list | grep -q 'Fronta je prázdná' || fail "queue list"
echo "ok queue list"

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) echo "skip serve (no SIGTERM on Windows)" ;;
  *)
    "$bin" serve --port 18082 > serve.log 2>&1 &
    pid=$!
    for _ in $(seq 1 30); do curl -sf localhost:18082/health > /dev/null && break; sleep 0.5; done
    curl -sf localhost:18082/health | grep -q '"status":"ok"' || { cat serve.log; fail "serve /health"; }
    kill -TERM "$pid"
    wait "$pid" || { cat serve.log; fail "serve exit code $?"; }
    echo "ok serve + clean stop"
    ;;
esac
