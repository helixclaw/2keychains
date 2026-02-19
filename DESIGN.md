# 2keychains

Bidirectional sync between macOS Keychain and 1Password.

## Problem

An AI assistant (running as the local user) needs access to secrets at runtime without biometric prompts. The human wants to manage those secrets in 1Password's UI. Neither side should be the single source of truth — both should stay in sync.

## How It Works

```
┌──────────────┐         sync         ┌──────────────┐
│  1Password   │ ◄──────────────────► │ macOS        │
│  (vault)     │   biometric required  │ Keychain     │
└──────────────┘   for 1P CLI access   └──────────────┘
       │                                      │
       │ human manages                        │ agent reads/writes
       │ via 1P app                           │ via `security` CLI
       ▼                                      ▼
   Nice UI, cross-device              No auth needed for
   backup, organization               logged-in user session
```

## Sync Directions

- **1Password → Keychain**: Pull secrets from a scoped 1Password vault into Keychain. Requires biometric auth (human present). This is the primary flow.
- **Keychain → 1Password**: Push new secrets the agent has stored in Keychain back to 1Password. Also requires biometric auth.

## Conventions

- All Keychain items are namespaced: `helix/<name>` (service field)
- 1Password items live in a dedicated vault (e.g. "Helix")
- Item names map 1:1 between both stores

## Sync Behavior

- **Conflict resolution**: 1Password wins (it's the human-managed source)
- **New items in Keychain**: Offered for import to 1Password during sync
- **Deleted items**: Deletion in 1Password removes from Keychain on next sync; deletion in Keychain does NOT remove from 1Password

## Requirements

- macOS (Keychain access via `security` CLI)
- 1Password 8+ with CLI (`op`) and desktop app integration
- 1Password vault scoped for agent use

## Usage

```bash
# Human runs when at desk (triggers biometric)
2keychains sync

# Pull only (1Password → Keychain)
2keychains pull

# Push only (Keychain → 1Password)
2keychains push

# List all synced secrets
2keychains list
```

## Non-Goals

- Not a general-purpose secret manager
- No network sync or cloud storage beyond what 1Password already provides
- No daemon/background process — sync is manual and intentional
