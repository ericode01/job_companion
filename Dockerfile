# Job Companion: web app + background worker in one container. State lives in Postgres
# (DATABASE_URL) and a GCS bucket (GCS_BUCKET), so the container keeps nothing that matters.
#   docker build --build-arg APP_ORIGIN=https://jobs.example.com -t job-companion .
#   docker run -d -p 127.0.0.1:4317:4317 --env-file .env.production job-companion
# Moving from SQLite: mount the old data/ at /data and run `pnpm db:copy-sqlite` once (README → Hosting).
# Put an HTTPS reverse proxy (Caddy, nginx, a load balancer) in front; see README → Hosting.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

# The public address is baked into the Chrome extension (it only ever talks to this server).
ARG APP_ORIGIN
ENV APP_ORIGIN=${APP_ORIGIN}
RUN test -n "$APP_ORIGIN" || (echo "Pass --build-arg APP_ORIGIN=https://your-domain" && exit 1)
RUN pnpm --filter @jd/web build && APP_URL="$APP_ORIGIN" pnpm --filter @jd/extension build

ENV NODE_ENV=production DATA_DIR=/data HOST=0.0.0.0 PORT=4317
VOLUME /data
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4317/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "serve"]
