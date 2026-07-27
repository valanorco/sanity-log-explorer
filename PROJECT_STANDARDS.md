# Project Standards

This document defines engineering standards for this repository.

## 1. Commit Standards

Use Conventional Commits for every commit.

Accepted commit types:
1. `feat`
2. `fix`
3. `perf`
4. `refactor`
5. `docs`
6. `test`
7. `build`
8. `ci`
9. `chore`
10. `style`
11. `revert`

Commit format:
1. `type(scope): short summary`
2. Breaking change: `type(scope)!: summary` and/or `BREAKING CHANGE:` in body.

Examples:
1. `feat(backend): add clear-data endpoint`
2. `fix(frontend): handle missing latency rows in anomaly analysis`
3. `refactor(ingestion): simplify partition derivation`

## 2. Dependency Management Policy

Always install dependencies through the package manager. Do not only edit manifest files.

Rules:
1. Python:
1. Use `pip install ...` in an active environment and then update requirement files as needed.
2. Prefer pinning runtime dependencies for reproducibility.
2. Node:
1. Use `pnpm add` / `pnpm add -D` instead of only editing `package.json`.
2. Keep lockfiles updated and committed.
3. Never hand-edit lockfiles.

## 3. Code Quality Standards

General:
1. Keep changes small and focused.
2. Prefer explicit, readable code over clever code.
3. Add tests for bug fixes and critical logic changes.
4. Avoid dead code and commented-out blocks.

Backend (Python/FastAPI):
1. Validate input via pydantic models.
2. Use parameterized SQL whenever possible.
3. Return sanitized error messages to clients.
4. Log detailed diagnostics server-side, not in API responses.
5. Keep routes thin; move complex logic to processing modules.

Frontend (Astro/React/TypeScript):
1. Keep components composable and state transitions explicit.
2. Avoid `any`; model API payloads with interfaces/types.
3. Handle loading/error states for network actions.
4. Keep rendering performant for large datasets (pagination/limits).

Data Engineering (DuckDB/dbt):
1. Keep raw ingestion and transformed models clearly separated.
2. Use deterministic transformations and idempotent model logic.
3. Document model assumptions and field mappings.
4. Prefer incremental or bounded operations for large volumes.

## 4. Security Standards

Minimum requirements:
1. Never expose secrets in source, logs, or client payloads.
2. Sanitize operational errors before returning to clients.
3. Keep CORS policy minimal for non-local deployments.
4. Enforce safe bounds on query limits and upload sizes where applicable.
5. Run dependency audits regularly.

Audit commands:
1. `make audit-backend`
2. `cd frontend && pnpm audit --prod`

## 5. CI and Release Expectations

1. PRs to `main` must pass:
1. Commit message lint workflow.
2. Release workflow checks.
2. Releases are generated from semantic commits:
1. Preview prerelease on PRs.
2. Stable release on direct pushes to `main`.

## 6. Pull Request Checklist

Before opening a PR:
1. Ensure commit messages follow Conventional Commits.
2. Run local build/tests relevant to changed code.
3. Run dependency/security audit when dependencies changed.
4. Update docs if behavior or API changed.
5. Add migration or rollback notes for data-model changes.
