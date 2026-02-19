# 2keychains - Project Conventions

## Commands

- **Build:** `npm run build` (compiles TypeScript to `dist/`)
- **Dev:** `npm run dev` (runs CLI directly via tsx)
- **Test:** `npm test` (runs Vitest)
- **Test (watch):** `npm run test:watch`
- **Lint:** `npm run lint` (ESLint + Prettier check)
- **Lint fix:** `npm run lint:fix` (auto-fix ESLint + Prettier)

## Directory Structure

```
src/
  cli/         # CLI entry point and command definitions
  core/        # Core business logic
  channels/    # Channel implementations (Discord, etc.)
  __tests__/   # Test files
dist/          # Build output (gitignored)
```

## Coding Conventions

- **Module system:** ESM (`"type": "module"` in package.json)
- **TypeScript:** Strict mode, ES2022 target, Node16 module resolution
- **Formatting:** Prettier (no semicolons, single quotes, trailing commas)
- **Testing:** Vitest with globals enabled; test files use `*.test.ts` pattern in `src/`
- **CLI framework:** Commander; command name is `2kc`
- **Node.js:** Requires >=20.0.0
