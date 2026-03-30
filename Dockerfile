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

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

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

EXPOSE 3131

ENV OPENEFFECT_HOST=0.0.0.0
ENV OPENEFFECT_PORT=3131
ENV OPENEFFECT_NO_BROWSER=true

CMD ["uv", "run", "python", "run.py"]
