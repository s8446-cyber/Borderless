# Deployment Guide — Borderless Pay

The backend has **zero runtime npm dependencies** (Node built-ins only), so it
runs anywhere Node 20+ runs. Pick one of the options below.

## 0. Generate secrets (required in production)

```bash
openssl rand -hex 48   # -> BP_SIGNING_SECRET
openssl rand -hex 32   # -> BP_ENC_KEY
```

The server **refuses to start in production** without both (fail-closed).

## 1. Run locally (development)

```bash
node src/server.js              # http://localhost:4000
npm test                        # 27 tests
```

In development, ephemeral secrets are auto-generated and CORS is open (`*`).

## 2. Docker (single host)

```bash
cp .env.example .env            # fill in BP_SIGNING_SECRET, BP_ENC_KEY, BP_CORS_ORIGINS
docker compose up --build -d
curl http://localhost:4000/api/health
```

Data persists in the `bp_data` volume. The image runs as a non-root user with a
built-in healthcheck.

## 3. Fly.io (recommended for India region)

```bash
fly launch --no-deploy
fly volumes create bp_data --size 1 --region bom
fly secrets set BP_SIGNING_SECRET=$(openssl rand -hex 48) \
               BP_ENC_KEY=$(openssl rand -hex 32) \
               BP_CORS_ORIGINS=https://your-frontend.example
fly deploy
```

HTTPS, autoscaling, and health checks are configured in `fly.toml`.

## 4. Render.com (blueprint)

1. Push this repo to GitHub.
2. Render → **New → Blueprint**, point at the repo (`render.yaml`).
3. `BP_SIGNING_SECRET` / `BP_ENC_KEY` are auto-generated; set `BP_CORS_ORIGINS`.
4. A 1GB persistent disk is mounted at `/app/data`.

## 5. Bare VM / systemd

```ini
# /etc/systemd/system/borderless-pay.service
[Service]
WorkingDirectory=/opt/borderless-pay
EnvironmentFile=/opt/borderless-pay/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
User=borderless
[Install]
WantedBy=multi-user.target
```

Put Nginx/Caddy in front for TLS termination and set `BP_TRUST_PROXY=true`.

## Reverse proxy notes

- Terminate TLS at the proxy/platform and forward to port 4000.
- Set `BP_TRUST_PROXY=true` so per-IP rate limiting reads `X-Forwarded-For`.
- The app already sends HSTS in production; ensure the proxy doesn’t strip it.

## Post-deploy verification

```bash
curl https://YOUR_HOST/api/health        # {"ok":true}
curl https://YOUR_HOST/api/ready         # ledger + audit integrity
curl -D - -o /dev/null https://YOUR_HOST/  # confirm CSP/HSTS headers present
```

## CI/CD

`.github/workflows/ci.yml` runs syntax checks + the full test suite on every
push/PR, then builds the Docker image and smoke-tests the container.

## Operations

- **Backups:** snapshot the data volume (`/app/data/db.json`) regularly.
- **Scaling:** for multi-instance, move the store to Postgres and rate-limit /
  lockout state to Redis (interfaces are isolated in `src/store.js` /
  `src/security.js`).
- **Monitoring:** scrape `/api/health` (liveness) and `/api/ready` (integrity).
  Logs are structured JSON with secret redaction — ship them to your log store.
