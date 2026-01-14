---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(pnpm:*), Bash(shasum:*), Bash(cat:*), Bash(sed:*), Bash(rm:*), Bash(cd:*), Read, Edit
description: Bump version, create release, build binary, and update homebrew
---

Create a new release for Sidecar.

## Steps

### 1. Determine Version Bump
Ask the user what type of version bump: patch (0.0.x), minor (0.x.0), or major (x.0.0).
Default to patch if not specified via $ARGUMENTS.

Current version is in `packages/server/package.json`.

### 2. Bump Version
Update the version in `packages/server/package.json`.
Update version in `packages/server/src/cli.ts`.

### 3. Commit and Tag
```bash
git add packages/server/package.json
git commit -m "chore: update version to <new-version>"
git tag v<new-version>
```

### 4. Push Changes
```bash
git push origin main
git push origin v<new-version>
```

### 5. Build Binary
```bash
pnpm build:binary
```

### 6. Generate Changelog
Get commits since the last tag:
```bash
git log --oneline <previous-tag>..HEAD --pretty=format:"- %s (%h)"
```

Group commits by type (feat, fix, chore, etc.) for the changelog.

### 7. Create GitHub Release
```bash
gh release create v<new-version> \
  --title "v<new-version>" \
  --notes "<changelog>"
```

### 8. Upload Binary to Release
```bash
gh release upload v<new-version> ./packages/server/sidecar --clobber
```

### 9. Update Homebrew Tap
Calculate SHA256 of the binary:
```bash
shasum -a 256 ./packages/server/sidecar | cut -d' ' -f1
```

Clone and update the homebrew tap:
```bash
gh repo clone Nikschavan/homebrew-sidecar /tmp/homebrew-sidecar
```

Update `Formula/sidecar.rb` with:
- New version number
- New SHA256 hash

Commit and push the homebrew changes:
```bash
cd /tmp/homebrew-sidecar
git add Formula/sidecar.rb
git commit -m "Update sidecar to v<new-version>"
git push
```

### 10. Cleanup
Remove temporary homebrew clone:
```bash
rm -rf /tmp/homebrew-sidecar
```

## Summary
After completion, output:
- New version number
- GitHub release URL
- Homebrew update status
