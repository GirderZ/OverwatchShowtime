# Overwatch Showtime

Windows desktop app: 屁股时间. Read README.md, REPORT_SCHEMA.md and VALIDATION.md before changes.

- Use Node.js 22.12+ and `npm ci`; run `npm test` for functional changes.
- `npm run release:win` builds the Windows x64 installer, portable ZIP and SHA-256 checksums in release/.
- Preserve executable name OverwatchTime.exe, app ID local.overwatch-time.desktop, legacy profile directory 守望时记, and data directory `%APPDATA%\OverwatchTime\data`.
- Keep app/windows/monitor.ps1 unpacked from ASAR. Do not collect keyboard contents or game memory.
- Statistics use Asia/Shanghai, Monday-based weeks and natural calendar months.
- Do not commit user data, local paths, build caches, archives, credentials or chat history.
- Pushing package.json version changes to main or a matching version tag triggers the GitHub release workflow. Manual workflow runs build artifacts only. Only publish when the user requests it.

## Installing for a user

When the user authorizes installation, download scripts/install.ps1 from a specific repository commit/tag or a release, inspect it, then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Version v0.2.1
```

The script checks the release installer SHA-256, installs for the current user without administrator access, and defaults to `%LOCALAPPDATA%\Programs\OverwatchShowtime`. Add `-Launch` only when the user wants the app opened. Existing app records are preserved. Do not enable startup or configure report delivery without user request.
