# Phase 6 â€” Hub UI Status

**Date:** 2026-11-10  **Verdict:** PASS â€” tarball UI acceptance completed in `PINNACLE-tarball`.

## Implemented

- Persistent MCP Hub sidebar entry and a main panel with Modules and Doctor tabs.
- English and Arabic copy, with English fallback for Chinese.
- Modules screen with live status, enable/disable and probe actions, in-page confirmation, feedback, refresh, and loading/error/empty states.
- Doctor screen with module diagnosis, backup readiness, and environment issues.
- Client Typert contribution mounted under `PINNACLEHub`; its client namespace waits for Cordis injection before the panel is registered.
- UI control actions go through `aec_control` and the existing tool execution policy. The page does not call module control methods directly.
- Status refreshes once per second while a module is starting, so the view follows the supervisor to its settled state.

## Live acceptance

The rebuilt tarball was installed into `~/.dsh/profiles/PINNACLE-tarball` and the profile was opened at port 3083.

- The persistent MCP Hub entry opened the page; Modules showed Revit and Navisworks as `app_not_running` and the Echo fixture as `connected`.
- Doctor loaded module diagnosis, backup readiness, and environment issues.
- Probe on Echo showed the in-page confirmation and returned `Probe succeeded Â· 93 ms`.
- Disable showed confirmation and changed Echo to `Disabled`; Enable showed confirmation and refreshed through `Starting` to `Connected`.
- The browser recorded no page errors or console errors during these interactions.

## Build and package

- `pnpm typecheck` â€” passed.
- `pnpm build` â€” passed; emitted `lib/index.js` and `lib/client.js`.
- `pnpm run pack` â€” passed.
- `@deepseek-ai/dsh-typert-protocol` is an optional package-manager peer supplied by DSH at runtime and stays external in the Host build.
- Final tarball: `dist/PINNACLE-mcp-hub-0.1.0-repack-20261110-v12.tgz`
- SHA-256: `F38A380A165D87D9D1E09FE2EA3B20B3A13830CA0A6DD79E1C6A6E5E952C9DEC`

## Remaining

Phase 6 has no remaining tasks. Phase 7 delivery, Phase 8 extension-seam documentation, and Phase 9 local QA are recorded in their respective status files. The colleague-device acceptance and DSH RC1 integration remain outside this phase.

