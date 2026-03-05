# Contributing to Taostats Auth Gateway

## Prerequisites

- Node.js 22 LTS
- PostgreSQL 15+
- OpenSSL (for RSA key generation)

## Getting Started

1. Fork and clone the repo.

2. Install dependencies:
   ```sh
   npm install
   ```

3. Generate RSA keys for JWT signing:
   ```sh
   npm run generate-keys
   ```

4. Create a PostgreSQL database:
   ```sql
   CREATE USER auth WITH PASSWORD 'auth_dev_password';
   CREATE DATABASE auth_gateway OWNER auth;
   ```

5. Copy `.env.dist` to `.env` and adjust values as needed:
   ```sh
   cp .env.dist .env
   ```
   The defaults work for local development. Key variables:
   - `DATABASE_URL` -- PostgreSQL connection string
   - `NETWORK` -- `mainnet` or `testnet`
   - `ADMIN_API_KEY` -- required in production

6. Start the dev server (auto-reloads on changes):
   ```sh
   npm run dev
   ```
   Migrations run automatically on startup when `RUN_MIGRATIONS=true`.

## Development Workflow

- Create a feature branch off `main`. Do not push directly to `main`.
- One logical change per commit. Use imperative mood, 72-char subject line.
- Keep PRs focused. Describe what the code does, not the journey to get there.

## Code Standards

- **TypeScript strict mode** -- all `strict` options enabled via `tsconfig.json`.
- **ESM only** -- use `import`/`export`, no `require`.
- **Functions** -- 100 lines max, 5 positional params max.
- **No commented-out code** -- delete it.
- **Error handling** -- fail fast with clear messages. Never swallow exceptions.

## Running Checks

All three must pass before submitting a PR:

```sh
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # jest
```

## Tests

Tests use Jest with in-memory mocks for the database and Substrate chain.

- Test files live in `src/` alongside the code they test (`*.test.ts`).
- Test behavior, not implementation.
- New features and bug fixes require tests.
- Cover edge cases and error paths, not just the happy path.

Run the full suite:
```sh
npm test
```

## Database Migrations

Migration files live in `migrations/` as numbered SQL files. To add a migration:

1. Create a new file: `migrations/NNN_description.sql`
2. Write idempotent SQL (use `IF NOT EXISTS` where appropriate).
3. Migrations run automatically on startup, tracked in the `_migrations` table.

## Submitting a PR

1. Ensure `typecheck`, `lint`, and `test` all pass with zero warnings.
2. Open a PR against `main` with a clear description of the change.
3. Keep the diff minimal -- don't bundle unrelated changes.

## Security Issues

Do not open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](LICENSE).
