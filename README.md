# Sidecar

A simple wrapper to access Claude Code from your phone over your local network or internet.

## What it does

Sidecar lets you control and monitor Claude Code sessions from any device on your network. Start a coding task on your terminal, then continue the conversation from your phone while you're away from your desk.

- Access Claude Code sessions from any device
- Send messages and approve tool permissions from your phone


1. Claude Code stores sessions in `~/.claude/projects/`
2. Sidecar server reads these sessions and exposes them via API
3. Open the web UI on your phone, authenticate with token
4. Send messages from phone → Sidecar spawns `claude --resume <session>`
5. Handoff back to terminal anytime - sessions persist

## Usage

```bash
# Start server in background
./sidecar start

# Check status and connection URLs
./sidecar status

# Stop the server
./sidecar stop

# Show or rotate auth token
./sidecar token
./sidecar token --rotate
```

On start, Sidecar displays all available URLs:
- **Local**: `http://localhost:3456`
- **Network**: `http://192.168.x.x:3456` (your LAN IP)
- **Tailscale**: `http://100.x.x.x:3456` (if Tailscale is active)

## Building from Source

Requires [Bun](https://bun.sh) for building the binary.

```bash
# Install dependencies
pnpm install

# Build web UI
pnpm build

# Generate embedded assets and compile binary
pnpm build:binary
```

## Architecture

```
packages/
├── server/          # Hono HTTP + WebSocket server
│   ├── src/
│   │   ├── cli.ts           # CLI entry point
│   │   ├── index.ts         # Server entry point
│   │   ├── routes/          # API routes
│   │   ├── ws/              # WebSocket handlers
│   │   └── web/             # Embedded asset serving
│   └── scripts/
│       └── generate-embedded-assets.ts
├── web/             # React PWA (embedded in binary)
└── shared/          # Shared types and protocol
```

**Key components:**
- **CLI**: Bun-compiled native binary with embedded web UI
- **Server**: Hono framework serving HTTP API and WebSocket
- **Web**: React PWA that connects via WebSocket
- **Auth**: Bearer token stored in `~/.sidecar/auth.json`
