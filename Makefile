.PHONY: dev test lint install build

dev:
	uv run python run.py

test:
	uv run pytest -q
	cd client && pnpm test

lint:
	uv run ruff check server/
	uv run mypy server/
	cd client && pnpm eslint . && pnpm tsc --noEmit

install:
	uv sync --all-extras
	cd client && pnpm install

build:
	cd client && pnpm build
	@echo "Build complete. Frontend at client/dist/"
