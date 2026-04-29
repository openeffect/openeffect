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


# Stage 2: Build the Python venv (kept separate so uv doesn't ship in the
# final image).
FROM python:3.12-slim AS python-builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# README.md is referenced by pyproject.toml's `readme` field, which
# hatchling validates during metadata resolution.
COPY pyproject.toml uv.lock README.md ./

# --no-dev drops pytest/ruff/mypy; the venv lands at /app/.venv. Same
# WORKDIR in the runtime stage keeps the venv's shebangs valid without
# rewriting.
RUN uv sync --frozen --no-dev


# Stage 3: Runtime. Non-root user for defense-in-depth.
FROM python:3.12-slim

RUN useradd -m -u 1000 openeffect \
 && mkdir -p /data /app \
 && chown openeffect:openeffect /data /app

USER openeffect
WORKDIR /app

# Files are born owned by openeffect (--chown on every COPY) so no post-hoc
# `chown -R` is needed - that otherwise doubles the venv's layer weight.
COPY --from=python-builder --chown=openeffect:openeffect /app/.venv ./.venv
COPY --chown=openeffect:openeffect run.py LICENSE ./
COPY --chown=openeffect:openeffect server/ ./server/
COPY --chown=openeffect:openeffect effects/ ./effects/
COPY --from=frontend --chown=openeffect:openeffect /build/dist/ ./client/dist/

EXPOSE 3131

# Bind 0.0.0.0 so Docker's port mapping can reach the process - container
# loopback is a distinct network namespace and a 127.0.0.1 bind would be
# unreachable even from the host. Fail-closed against the LAN is enforced
# on the host side in docker-compose.yml (`127.0.0.1:3131:3131`).
ENV OPENEFFECT_USER_DATA_DIR=/data
ENV OPENEFFECT_HOST=0.0.0.0
ENV OPENEFFECT_PORT=3131
ENV OPENEFFECT_NO_BROWSER=true

CMD [".venv/bin/python", "run.py"]
