# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build:** `npm run build` (uses tsup, outputs to `dist/`)
- **Dev:** `npm run dev` (tsup watch mode)
- **Test:** `npm test` (Vitest with coverage, 95% threshold)
- **Test (watch):** `npm run test:watch`
- **Test (no coverage):** `npm run test:no-coverage`
- **Single test:** `npx vitest run src/__tests__/filename.test.ts`
- **Lint:** `npm run lint` (ESLint + Prettier, auto-fix)
- **Lint (check only):** `npm run lint:no-fix`
- **Type check:** `npm run compile` (tsc --noEmit)

## Architecture

2keychains is a local secret broker for AI agents. It replaces direct secret access with a controlled intermediary featuring approval workflows, placeholder injection, and output redaction.

### Service Layer (`src/core/service.ts`)

The `Service` interface is the central abstraction. Two implementations:

- **LocalService** — Standalone mode. Owns the encrypted store, unlock session, grant manager, and workflow engine. Handles the full lifecycle: unlock → request → approve → inject.
- **RemoteService** — Client mode. Proxies requests to a running 2kc server via HTTP.

`resolveService(config)` returns the appropriate implementation based on `config.mode`.

### Request-Grant Flow

1. CLI creates an `AccessRequest` via `Service.requests.create()`
2. `WorkflowEngine.processRequest()` checks if approval is needed (based on secret tags and `requireApproval` config)
3. If approval required, sends to `NotificationChannel` (Discord) and waits for response
4. On approval, `GrantManager.createGrant()` creates a signed JWT grant
5. `SecretInjector.inject()` resolves `2k://` placeholders and runs the command with secrets in env

### Key Components

- **EncryptedSecretStore** — AES-GCM encrypted secret storage with Argon2 KDF
- **UnlockSession** — In-memory DEK holder with TTL, idle timeout, and max-grants limits
- **SessionLock** — Persists session state to disk for CLI session continuity
- **GrantManager** — Issues and validates Ed25519-signed JWS grants
- **SecretInjector** — Resolves placeholders, spawns subprocess, redacts secrets from output
- **WorkflowEngine** — Orchestrates approval flow between store, channel, and config

### Server (`src/server/`)

Fastify server with bearer token auth. Routes delegate to the `Service` interface.

### Channels (`src/channels/`)

`NotificationChannel` interface for approval workflows. Discord implementation sends embeds and polls for emoji reactions.

## Coding Conventions

- **ESM only** — `"type": "module"`, use `.js` extensions in imports
- **Strict TypeScript** — ES2022 target, Node16 module resolution
- **Prettier** — No semicolons, single quotes, trailing commas
- **Tests** — Vitest with globals; `*.test.ts` files in `src/__tests__/`
- **CLI** — Commander framework; binary name is `2kc`
- **Node.js** — Requires >=20.0.0
