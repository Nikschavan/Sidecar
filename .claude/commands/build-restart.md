---
allowed-tools: Bash(pnpm:*)
description: Build the binary and restart the sidecar service
---

Build the sidecar binary and restart the service.

1. Build the binary: `pnpm build:binary`
2. If build succeeds, restart the sidecar: `pnpm restartsidecar`
