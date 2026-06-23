# Borderless Pay backend — minimal, hardened container image.
# Zero runtime npm dependencies, so the image stays tiny and the attack surface
# is small. Runs as a non-root user with a built-in healthcheck.
FROM node:20-alpine AS base

# Create an unprivileged user/group
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# Copy manifest first for better layer caching (no deps to install)
COPY package.json ./

# Copy application source
COPY src ./src
COPY public ./public

# Data directory for the file-backed store (also mountable as a volume)
RUN mkdir -p /app/data && chown -R app:app /app

ENV NODE_ENV=production \
    BP_ENV=production \
    PORT=4000 \
    BP_DB=/app/data/db.json

USER app
EXPOSE 4000

# Container healthcheck hits the readiness endpoint (verifies ledger + audit)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
