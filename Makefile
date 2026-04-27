.PHONY: dev test lint install build openapi gen-types

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

# Dump FastAPI's OpenAPI schema to ./openapi.json. Imports the app the
# same way uvicorn does, so the routes registered match what the
# running server exposes.
openapi:
	cd server && uv run python -c "import json, sys; from main import app; sys.stdout.write(json.dumps(app.openapi(), indent=2))" > openapi.json
	@echo "Wrote openapi.json"

# Regenerate client/src/types/api.gen.ts from the live OpenAPI schema.
# `api.gen.ts` is the source-of-truth for backend response shapes; the
# hand-maintained `api.ts` stays for now (it carries richer narrowed
# types the loose dict-returning routes can't express). New code should
# prefer the generated types when the matching shape exists there.
gen-types: openapi
	cd client && pnpm gen-types
	@echo "Wrote client/src/types/api.gen.ts"
