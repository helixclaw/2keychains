# 2KeyChain v0.5 (MVP -- Local Only)

## Overview

Version 0.5 is a local-only secret broker that replaces direct secret access with a controlled intermediary. It introduces manual approval, contextual justification, UUID abstraction, and ephemeral injection. This version is NOT fully secure. It is intended to introduce friction and auditing while development continues.

---

## Architecture

- Runs locally on the same machine as the AI
- Replaces direct security CLI usage
- Fetches secrets from a local database (synced externally from 1Password or other vault)
- Injects secrets directly into process environments (never exposes raw values to AI)
- Uses Discord webhook/bot for approval flow
- Logs access attempts to Discord

It should be designed with a clean "channel" Interface so that in the future I could integrate other forms of verification, for example, via email, via Slack, via text message, etc. For now, we will just focus on a discord webhook/bot.

Also, instead of syncing secrets to the OSX keychain, let's just use a plain text JSON file for now. Integration with the keychain will happen at a later phase.

---

## Core Features

### 1. UUID Mapping Layer

- Store secrets as UUIDs internally
- Maintain UUID → human-readable mapping database
- AI only interacts with UUID references

### 2. Contextual Justification (Required)

Each access request must include:

- Reason for access
- Task reference (ticket/job/commit)
- Duration requested (default: 5 minutes)

### 3. Manual Approval (Tag-Based)

- Global config defines which secrets require approval
- Approval via Discord webhook or bot reaction
- Confirm / Deny workflow

### 4. Time-Bound Access

- Access granted for short window (e.g., 5 minutes)
- Auto-expiration
- No persistent caching

### 5. Ephemeral Injection

- Secret values injected directly into process environment
- AI never sees raw secret value
- Memory cleared immediately after use

### 6. Stateless Design

Flow:

1. Request
2. Approve
3. Fetch from local database
4. Inject into process
5. Purge

---

## Nice-to-Have (Post-MVP)

- Honeytoken / decoy secrets
- Rate limiting
- Basic anomaly detection

---

## Security Limitations

- Runs on same host as AI
- Can be bypassed by attacker with system-level access
- Not resistant to privilege escalation

---

## Validation Checklist

### Functional Tests

- [ ] AI cannot directly access secret database
- [ ] All requests require justification
- [ ] Tagged secrets require Discord approval
- [ ] Access expires after time limit
- [ ] Secret is not printed in logs or output
- [ ] Discord logs show request and approval status

### Security Tests

- [ ] Attempt to list secrets → only UUIDs visible
- [ ] Attempt to reuse expired access → denied
- [ ] Verify no secret caching persists in memory

---

## Exit Criteria for v0.5

- All secrets routed through broker
- Approval workflow stable
- Logging consistent and reliable
