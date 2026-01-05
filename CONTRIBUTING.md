# Contributing to Sidecar

## Development Setup

```bash
# Clone the repository
git clone https://github.com/user/sidecar.git
cd sidecar

# Install dependencies
pnpm install

# Run in development mode
pnpm dev        # Server only
pnpm dev:web    # Web UI only (with hot reload)
pnpm start      # Both server and web UI
```

## Building

```bash
# Build everything
pnpm build

# Build the standalone binary
pnpm build:binary
```

The binary will be created at `packages/server/sidecar`.

## Project Structure

```
packages/
├── server/   # Hono HTTP + SSE server, CLI
├── web/      # React PWA
└── shared/   # Shared types and protocol
```

## Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `pnpm typecheck` to ensure no type errors
5. Commit with a descriptive message
6. Push and open a PR

## Reporting Issues

When reporting bugs, please include:
- Steps to reproduce
- Expected vs actual behavior
- OS and Node.js version
