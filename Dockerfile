# syntax=docker/dockerfile:1
# EET Gateway HTTP service (docs/SERVER.md).
#   docker build -t eet-gateway .
#   docker run -p 8080:8080 -e EET_API_KEYS=… \
#     -v ./eet.config.yaml:/etc/eet/eet.config.yaml:ro -v ./certs:/certs:ro -v eet-data:/data eet-gateway

FROM oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS build
WORKDIR /src
COPY package.json bun.lock bunfig.toml ./
COPY packages/core/package.json packages/core/
COPY packages/ingest/package.json packages/ingest/
COPY packages/queue/package.json packages/queue/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY packages ./packages
RUN bun build packages/server/src/main.ts --target bun --outfile /out/server.js \
 && mkdir -p /out-data

FROM oven/bun:1.4.4-distroless@sha256:153a951ae40106e125898103e6e990ee0f38e6aee7f561029e26cf9fbed23470
WORKDIR /app
COPY --from=build /out/server.js /app/server.js
# A named volume mounted here starts out owned by the unprivileged user.
COPY --from=build --chown=65532:65532 /out-data /data
ENV EET_CONFIG=/etc/eet/eet.config.yaml \
    EET_DB_PATH=/data/eet-queue.db \
    EET_HOST=0.0.0.0 \
    EET_PORT=8080 \
    # Resolve DNS on every new connection (production access rules, P §2.1); Bun caches 30 s.
    BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS=0
USER 65532:65532
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --start-interval=2s \
  CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.EET_PORT}/health`).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["bun", "/app/server.js"]
