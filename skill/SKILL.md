---
name: 2keychains
description: A local secret broker that provides controlled access to secrets through UUID abstraction, approval workflows, and ephemeral injection. Secrets are never exposed directly to the agent.
metadata:
  version: 0.1.0
  cli: 2kc
  category: secret-management
  permissions:
    - process:spawn
    - network:localhost
  tags:
    - secrets
    - keychain
    - security
    - approval-workflow
---

# 2keychains

2keychains is a local secret broker that sits between you (the agent) and stored secrets. It ensures you never see raw secret values. Instead, you work with UUID references, request access with justification, and secrets are injected directly into process environments for the commands that need them.

## When to Use This Skill

Use 2keychains when a task requires credentials, API keys, tokens, or other sensitive values. Common scenarios:

- Deploying code that needs cloud provider credentials
- Running scripts that require database connection strings
- Calling external APIs that require authentication tokens
- Any operation where a secret must be present in the environment

## Available Commands

### List secrets

List all secrets available in the local store. Returns UUIDs and tags only -- never secret values.

```sh
2kc secrets list
```

Output is JSON:

```json
[
  { "uuid": "a1b2c3d4-...", "tags": ["deploy", "aws"] },
  { "uuid": "e5f6a7b8-...", "tags": ["database"] }
]
```

Use the UUID from this output when making access requests.

### Request access to a secret

Request time-bound access to a secret. You must provide a reason and a task reference. Some secrets require human approval via a notification channel (e.g., Discord) before access is granted.

```sh
2kc secrets request \
  --uuid <secret-uuid> \
  --reason "Deploying frontend to staging" \
  --task-ref "ISSUE-42" \
  --duration 300
```

Parameters:

- `--uuid` (required): The UUID of the secret from `2kc secrets list`
- `--reason` (required): Why you need this secret -- be specific
- `--task-ref` (required): Reference to the task, ticket, or job that requires access
- `--duration` (optional): Access window in seconds (default: 300, min: 30, max: 3600)

The command blocks until the request is approved, denied, or times out. On approval, it outputs a grant ID:

```
grant:f9e8d7c6-...
```

If the secret's tags match an approval rule, a human must approve the request before a grant is issued. If denied or timed out, the command exits with a non-zero status.

### Inject a secret into a process

Run a command with an approved secret injected as an environment variable. The secret value is placed into the spawned process's environment and never printed or returned to you.

```sh
2kc secrets inject \
  --grant <grant-id> \
  --env-var SECRET_KEY \
  -- npm run deploy
```

Parameters:

- `--grant` (required): The grant ID received from a successful `request` command
- `--env-var` (required): Name of the environment variable to set in the child process
- `--` (required): Separator before the command to execute

The command runs the specified program with the secret set as the named environment variable. After the process exits, the grant is marked as used and the secret reference is cleared.

## Typical Workflow

A complete secret access flow follows these steps:

```sh
# 1. Find the secret you need
2kc secrets list

# 2. Request access with justification
2kc secrets request \
  --uuid a1b2c3d4-... \
  --reason "Running database migration for schema v12" \
  --task-ref "ISSUE-99" \
  --duration 300

# 3. Use the grant to inject the secret into your command
2kc secrets inject \
  --grant f9e8d7c6-... \
  --env-var DATABASE_URL \
  -- npm run migrate
```

## Constraints and Security Rules

- **You will never see secret values.** The broker injects them into child process environments. Do not attempt to read, print, or log environment variables containing secrets.
- **Every request requires justification.** You must provide a reason and a task reference. Vague justifications may be denied by the human approver.
- **Access is time-bound.** Grants expire after the requested duration. If the grant expires before you use it, you must request again.
- **Grants are single-use.** Each grant can be used for exactly one `inject` invocation. Request a new grant for each command that needs a secret.
- **Some secrets require human approval.** Secrets tagged with approval rules will block until a human approves or denies the request. Do not retry immediately if denied -- inform the user instead.
- **Process output limits apply.** Injected processes have a 10 MB output buffer limit and a default 30-second timeout.

## Error Handling

- If `request` is denied, report the denial to the user and do not retry without new instructions.
- If `request` times out, inform the user that approval was not received in time.
- If `inject` fails because the grant is expired or invalid, request a new grant.
- If the injected process exits with a non-zero code, report the exit code and stderr output.
