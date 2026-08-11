.PHONY: install format format-check lint test repo-check verify

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

repo-check:
	npm run repo:check

verify:
	npm run verify
