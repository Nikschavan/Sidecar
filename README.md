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

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed and authenticated
- [Bun](https://bun.sh) (for building from source)

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

### CLI Options

```bash
./sidecar start [options]
  -p, --port <port>    Use custom port (default: 3456)
  -f, --foreground     Run in foreground instead of background

./sidecar -v, --version    Show version
./sidecar help             Show help
```

On start, Sidecar displays all available URLs:
- **Local**: `http://localhost:3456`
- **Network**: `http://192.168.x.x:3456` (your LAN IP)
- **Tailscale**: `http://100.x.x.x:3456` (if Tailscale is active)

## PWA & Push Notifications

Sidecar's web UI is a Progressive Web App (PWA) that can be installed on your phone for a native app-like experience. It supports push notifications to alert you when Claude needs permission approval.

**HTTPS Required**: Push notifications require HTTPS. Use a reverse proxy to expose Sidecar over HTTPS:

```bash
# Using ngrok
ngrok http 3456

# Using Cloudflare Tunnel
cloudflared tunnel --url http://localhost:3456
```

Once accessible via HTTPS:
1. Open the URL on your phone
2. Install the PWA ("Add to Home Screen")
3. Enable notifications when prompted
4. You'll receive push notifications for permission requests even when the app is in the background

## Installation

### Homebrew (macOS)

```bash
brew install nikschavan/sidecar/sidecar
```

### Download Binary

Download the latest binary from [Releases](https://github.com/Nikschavan/Sidecar/releases).

### Building from Source

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
├── server/          # Hono HTTP + SSE server
│   ├── src/
│   │   ├── cli.ts           # CLI entry point
│   │   ├── index.ts         # Server entry point
│   │   ├── routes/          # API routes
│   │   ├── sse/             # Server-Sent Events handlers
│   │   └── web/             # Embedded asset serving
│   └── scripts/
│       └── generate-embedded-assets.ts
├── web/             # React PWA (embedded in binary)
└── shared/          # Shared types and protocol
```

**Key components:**
- **CLI**: Bun-compiled native binary with embedded web UI
- **Server**: Hono framework serving HTTP API and SSE (Server-Sent Events)
- **Web**: React PWA that connects via SSE for real-time updates
- **Auth**: Bearer token stored in `~/.sidecar/auth.json`
