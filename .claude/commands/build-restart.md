---
allowed-tools: Bash(pnpm:*), Bash(sidecar:*), Bash(sleep:*)
description: Build the binary and restart the sidecar service
---

Build the sidecar binary and restart the service.

1. Build the binary: `pnpm build:binary`
2. If build succeeds, restart the sidecar: `pnpm restartsidecar`
3. Wait 3 seconds, then check `sidecar status`. If it's not running, the new binary likely failed — fall back to starting the installed version: `sidecar start`
