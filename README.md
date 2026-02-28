# 2keychains

![CI](https://github.com/helixclaw/2keychains/actions/workflows/ci.yml/badge.svg)
![Coverage](https://img.shields.io/badge/coverage-0%25-red)

A local secret broker for AI agents. Replaces direct secret access with a controlled intermediary featuring human-readable references, approval workflows, placeholder-based injection, and output redaction.

## Features

- **Human-readable refs** — Secrets are addressed by slug (`perplexity-api-key`) or UUID
- **Approval workflows** — Tag-based rules route secrets through Discord for human approval
- **Batch grants** — Request multiple secrets in a single approval
- **Placeholder injection** — Set env vars to `2k://my-secret` and they're resolved at runtime
- **Output redaction** — Secret values in subprocess stdout/stderr are replaced with `[REDACTED]`
- **Client-server mode** — Run as a local daemon with bearer token auth

## Installation

```bash
git clone https://github.com/helixclaw/2keychains.git
cd 2keychains
npm install
npm run build
```

The CLI is available as `2kc` via the `dist/cli/index.js` entry point:

```bash
# Run directly
node dist/cli/index.js --help

# Or link globally
npm link
2kc --help
```

## Quick Start

### 1. Initialize configuration

```bash
2kc config init
```

This creates `~/.2kc/config.json` with defaults. Options:

```bash
2kc config init \
  --mode standalone \
  --store-path ~/.2kc/secrets.json \
  --webhook-url https://discord.com/api/webhooks/... \
  --bot-token YOUR_DISCORD_BOT_TOKEN \
  --channel-id YOUR_DISCORD_CHANNEL_ID \
  --default-require-approval \
  --approval-timeout 300000
```

### 2. Add secrets

```bash
# With inline value
2kc secrets add --ref my-api-key --value sk-abc123 --tags api production

# From stdin
echo "sk-abc123" | 2kc secrets add --ref my-api-key --tags api

# Interactive prompt (when stdin is a TTY)
2kc secrets add --ref my-api-key
```

The `--ref` must be a URL-safe slug: lowercase alphanumeric and hyphens (`[a-z0-9][a-z0-9-]*[a-z0-9]`).

### 3. List secrets

```bash
2kc secrets list
```

Output includes `uuid`, `ref`, and `tags` for each secret. Values are never exposed.

### 4. Remove secrets

```bash
# By ref
2kc secrets remove my-api-key

# By UUID
2kc secrets remove 550e8400-e29b-41d4-a716-446655440000
```

### 5. Request access and inject

```bash
# Single secret with explicit env var
2kc request my-api-key \
  --reason "Deploy to production" \
  --task "JIRA-123" \
  --env API_KEY \
  --cmd "curl -H 'Authorization: Bearer \$API_KEY' https://api.example.com"

# Multiple secrets (batch grant)
2kc request db-password api-key \
  --reason "Run migration" \
  --task "JIRA-456" \
  --cmd "node migrate.js"

# Placeholder injection (env vars containing 2k:// are auto-resolved)
export MY_KEY="2k://my-api-key"
2kc request my-api-key \
  --reason "Test endpoint" \
  --task "DEV-1" \
  --cmd "node app.js"
```

Options:

- `--reason` (required) — Justification for access
- `--task` (required) — Task/ticket reference
- `--env <varName>` — Inject secret into this env var
- `--cmd` (required) — Command to run with secrets injected
- `--duration <seconds>` — Grant validity (default: 300, range: 30–3600)

### Inject command

For workflows with multiple secrets, use the `inject` command which scans environment variables for `2k://` placeholders:

```bash
# Set env vars with secret placeholders
export DB_PASS="2k://db-password"
export API_KEY="2k://api-key-prod"

# Inject all found placeholders
2kc inject --reason "Deploy" --task "DEPLOY-123" --cmd "./deploy.sh"

# Only inject specific vars
2kc inject --vars "DB_PASS,API_KEY" --reason "test" --task "T-1" --cmd "./run.sh"
```

Options:

- `--reason` (required) — Justification for access
- `--task` (required) — Task/ticket reference
- `--cmd` (required) — Command to run with secrets injected
- `--vars <varList>` — Comma-separated list of env var names to check (default: scan all)
- `--duration <seconds>` — Grant validity (default: 300)

### 6. View configuration

```bash
2kc config show
```

Displays current config with sensitive values redacted.

## Configuration

Config file: `~/.2kc/config.json`

```json
{
  "mode": "standalone",
  "server": {
    "host": "127.0.0.1",
    "port": 2274,
    "authToken": "your-server-token"
  },
  "store": {
    "path": "~/.2kc/secrets.json"
  },
  "discord": {
    "webhookUrl": "https://discord.com/api/webhooks/...",
    "botToken": "your-bot-token",
    "channelId": "your-channel-id"
  },
  "requireApproval": {
    "production": true,
    "dev": false
  },
  "defaultRequireApproval": false,
  "approvalTimeoutMs": 300000
}
```

### Config Fields

| Field                    | Type                         | Default                     | Description                                                                 |
| ------------------------ | ---------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `mode`                   | `"standalone"` \| `"client"` | `"standalone"`              | Operating mode. Standalone runs locally; client connects to a remote server |
| `server.host`            | string                       | `"127.0.0.1"`               | Server bind address                                                         |
| `server.port`            | number                       | `2274`                      | Server port                                                                 |
| `server.authToken`       | string                       | —                           | Bearer token for client-server auth                                         |
| `server.pollIntervalMs`  | number                       | `3000`                      | Polling interval for grant status (ms)                                      |
| `store.path`             | string                       | `"~/.2kc/secrets.enc.json"` | Path to the secrets JSON file                                               |
| `discord.webhookUrl`     | string                       | —                           | Discord webhook URL for approval messages                                   |
| `discord.botToken`       | string                       | —                           | Discord bot token for reading reactions                                     |
| `discord.channelId`      | string                       | —                           | Discord channel ID for approval polling                                     |
| `requireApproval`        | object                       | `{}`                        | Tag → boolean map. Tags set to `true` require human approval                |
| `defaultRequireApproval` | boolean                      | `false`                     | Default approval requirement for untagged secrets                           |
| `approvalTimeoutMs`      | number                       | `300000`                    | How long to wait for approval (ms)                                          |

## Server Mode

Run 2keychains as a background daemon for remote/multi-process access:

```bash
# Generate an auth token
2kc server token generate

# Start the daemon
2kc server start

# Start in foreground (for debugging)
2kc server start --foreground

# Check status
2kc server status

# Stop the daemon
2kc server stop
```

The server listens on `http://{host}:{port}` with bearer token authentication. The health endpoint (`GET /health`) is unauthenticated.

### Client Mode

To connect to a running server, set mode to `client` in your config:

```bash
2kc config init --mode client --server-host 127.0.0.1 --server-port 2274 --server-auth-token YOUR_TOKEN
```

All CLI commands then proxy through the server transparently.

## Approval Workflow

When a secret's tags match a `requireApproval` rule (or `defaultRequireApproval` is true), 2keychains sends an approval request to Discord:

1. An embed message is posted to the configured webhook with request details
2. The CLI polls for emoji reactions on the message:
   - ✅ → Approved
   - ❌ → Denied
3. If no response within `approvalTimeoutMs`, the request times out

Secrets tagged with `dev: false` skip approval even when `defaultRequireApproval` is true.

## Placeholder Injection (`2k://`)

Instead of explicit `--env` flags, you can set environment variables to `2k://` URIs:

```bash
export DATABASE_URL="2k://db-connection-string"
export API_KEY="2k://my-api-key"

2kc request db-connection-string my-api-key \
  --reason "Run app" \
  --task "DEV-1" \
  --cmd "node server.js"
```

The injector scans `process.env` for `2k://` patterns, resolves each against the grant's secret pool, and replaces them before spawning the subprocess. Unresolved placeholders cause the request to fail (no partial injection).

## Output Redaction

Any secret value that appears in subprocess stdout or stderr is automatically replaced with `[REDACTED]`. This works at the stream level, handling secrets that span chunk boundaries.

## OpenClaw Integration

Install the 2keychains skill for OpenClaw:

```bash
2kc openclaw install
```

This creates a symlink at `~/.openclaw/workspace/skills/2keychains` pointing to the `skill/` directory. To remove:

```bash
2kc openclaw uninstall
```

## Environment Variables

2keychains itself doesn't use environment variables for configuration — everything is in `~/.2kc/config.json`. However, the following paths are relevant:

| Path                  | Description                           |
| --------------------- | ------------------------------------- |
| `~/.2kc/config.json`  | Configuration file (0600 permissions) |
| `~/.2kc/secrets.json` | Secret store (0600 permissions)       |
| `~/.2kc/server.pid`   | Server daemon PID file                |
| `~/.2kc/server.log`   | Server daemon log file                |

## Development

```bash
# Run CLI in dev mode (no build step)
npm run dev -- secrets list

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Lint and auto-fix
npm run lint:fix

# Build
npm run build
```

### Tech Stack

- **TypeScript** (strict mode, ES2022, ESM)
- **Commander** for CLI
- **Fastify** for the server
- **Vitest** for testing
- **Node.js ≥ 20**

## License

MIT
