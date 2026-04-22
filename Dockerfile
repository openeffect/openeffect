# Stage 1: Build frontend
FROM node:20-slim AS frontend

RUN npm install -g pnpm

WORKDIR /build

# Copy dependency files first for layer caching
COPY client/package.json client/pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY client/ ./

RUN pnpm build

# Stage 2: Python app
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Non-root runtime user + a stable data dir owned by them, so a code-exec
# bug in any upstream dependency can't escape with root privileges.
RUN useradd -m -u 1000 openeffect \
 && mkdir -p /data \
 && chown openeffect:openeffect /data

WORKDIR /app

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock ./

# Install Python dependencies (no dev deps)
RUN uv sync --frozen --no-dev

# Copy application
COPY run.py .
COPY server/ ./server/
COPY effects/ ./effects/

# Copy built frontend from stage 1
COPY --from=frontend /build/dist/ ./client/dist/

# Flip ownership of /app so the runtime user can read the venv + code
RUN chown -R openeffect:openeffect /app

EXPOSE 3131

# Bind 0.0.0.0 so Docker's port mapping can reach the process — container
# loopback is a distinct network namespace and a 127.0.0.1 bind would be
# unreachable even from the host. Fail-closed against the LAN is enforced
# on the host side in docker-compose.yml (`127.0.0.1:3131:3131`).
ENV OPENEFFECT_USER_DATA_DIR=/data
ENV OPENEFFECT_HOST=0.0.0.0
ENV OPENEFFECT_PORT=3131
ENV OPENEFFECT_NO_BROWSER=true

USER openeffect

CMD ["uv", "run", "python", "run.py"]
