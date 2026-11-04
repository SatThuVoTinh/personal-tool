.PHONY: install format format-check lint test test-knowledge repo-check verify

install:
	npm ci

format:
	npm run format

format-check:
	npm run format:check

lint:
	npm run lint

test:
	npm test

test-knowledge:
	npm run test:knowledge

repo-check:
	npm run repo:check

verify:
	npm run verify
