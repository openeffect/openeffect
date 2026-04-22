.PHONY: dev test lint install build

dev:
	@echo "Starting OpenEffect in development mode..."
	@trap 'kill %1 %2' EXIT; \
	  (cd server && uv run uvicorn main:app --reload --port 3131) & \
	  (cd client && pnpm dev) & \
	  wait

test:
	uv run pytest
	cd client && pnpm test

lint:
	uv run ruff check server/
	cd client && pnpm eslint . && pnpm tsc --noEmit

install:
	uv sync --all-extras
	cd client && pnpm install

build:
	cd client && pnpm build
	@echo "Build complete. Frontend at client/dist/"
