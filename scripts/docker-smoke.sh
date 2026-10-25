#!/usr/bin/env bash
# Starts the Docker image with the shared playground certificate and checks the API surface,
# the container health check, the queue database on /data and a clean stop. Sends nothing to EET.
# Usage: scripts/docker-smoke.sh [image]   (needs .cache/playground: bun run certs:playground)
set -euo pipefail
image=${1:-eet-gateway:dev}
name=eet-smoke-$$
port=18081
key=docker-smoke-key-0123456789
work=$(mktemp -d)
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

mkdir -p "$work/certs"
cp .cache/playground/CA_EET-Playground-CZ00000019.p12 "$work/certs/kasa.p12"
cp .cache/playground/password_pokladni_cert_playground.txt "$work/certs/kasa.password"
cat > "$work/eet.config.yaml" <<YAML
registers:
  kasa-1:
    environment: playground
    certificates: [{ p12: /certs/kasa.p12, passwordFile: /certs/kasa.password }]
    defaults: { id_jednotky: 11, id_pokl: KASA-1 }
YAML
chmod -R a+rX "$work"

docker run -d --name "$name" -p "$port:8080" -e "EET_API_KEYS=$key" \
  -v "$work/eet.config.yaml:/etc/eet/eet.config.yaml:ro" -v "$work/certs:/certs:ro" "$image" >/dev/null
fail() { echo "FAIL $*"; docker logs "$name"; exit 1; }
for _ in $(seq 1 30); do curl -sf "localhost:$port/health" >/dev/null && break; sleep 1; done

check() {
  local expected=$1 got
  shift
  got=$(curl -s -o /dev/null -w '%{http_code}' "$@")
  [ "$got" = "$expected" ] || fail "$* → $got (expected $expected)"
  echo "ok $expected ${*: -1}"
}
base="localhost:$port"
check 200 "$base/health"
check 200 "$base/openapi.json"
check 200 "$base/docs"
check 401 "$base/v1/registers"
check 200 -H "Authorization: Bearer $key" "$base/v1/registers"
check 200 -H "Authorization: Bearer $key" -H 'content-type: application/json' \
  -d '{"porad_cis":"D-1","dat_trzby":"2026-10-25T18:00:00+01:00","celk_trzba":"1.00"}' "$base/v1/validate"

status=starting
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$name")
  [ "$status" = healthy ] && break
  sleep 1
done
[ "$status" = healthy ] || fail "container health: $status"
echo "ok container healthy"
docker exec "$name" bun -e 'require("node:fs").statSync("/data/eet-queue.db")' || fail "no database on /data"
echo "ok database on /data"
[ "$(docker exec "$name" bun -e 'console.log(process.getuid())')" = 65532 ] || fail "runs as root"
echo "ok unprivileged user"

docker stop -t 20 "$name" >/dev/null
code=$(docker inspect -f '{{.State.ExitCode}}' "$name")
[ "$code" = 0 ] || fail "exit code $code after SIGTERM"
echo "ok clean stop"
