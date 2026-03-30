.PHONY: dev test lint install build

dev:
	@echo "Starting OpenEffect in development mode..."
	@trap 'kill %1 %2' EXIT; \
	  (cd server && uv run fastapi dev --port 3131) & \
	  (cd client && pnpm dev) & \
	  wait

test:
	cd server && uv run pytest
	cd client && pnpm test

lint:
	cd server && uv run ruff check . && uv run mypy .
	cd client && pnpm eslint . && pnpm tsc --noEmit

install:
	cd server && uv sync
	cd client && pnpm install
	cd cli && npm install

build:
	cd client && pnpm build
	@echo "Build complete. Frontend at client/dist/"
