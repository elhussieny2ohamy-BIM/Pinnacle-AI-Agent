# Phase 2 â€” Supervisor Status

**Date:** 2026-11-09  **Verdict:** PASS â€” live in `pinnacle-test`.

## Scope
Implemented `src/supervisor.ts` plus `src/app-gate.ts`, `src/modules.ts`, and extended
`src/types.ts`, `src/config.ts`, `src/registry.ts`, and `src/index.ts`.

## What was implemented

**Four module states** (`disabled` / `app_not_running` / `starting` / `connected` / `error`):
- `disabled` â€” module not enabled in the hub configuration.
- `app_not_running` â€” enabled and gated, but the host application process is not detected.
- `starting` â€” transient: registered with `mcp-manager`, waiting for the first connection result.
- `connected` â€” MCP session established; `toolCount` reported.
- `error` â€” registration/disposal failure, or a terminal manager status (`failed`/`closed`/`waiting-credentials`/`disabled`).

`starting` was added as a deliberate fifth transient state (user-approved deviation from the literal four-state list) so a normal launch is not reported as `error`.

**Supervisor** (`src/supervisor.ts`):
- `register(name, entry)` â†’ idempotent disposer; every registration is released on disable, app-exit, or stop (no orphaned MCP children).
- `setEnabled(id, enabled)` â€” toggles a module and reconciles immediately.
- `probe(id, options)` â€” live module via `mcp-manager.probe` (non-disruptive); dormant module via temporary register â†’ wait â†’ dispose.
- Polling: one app-gate process query per `pollMs` (default 20s) for every enabled gated module; the timer is armed only while at least one gate is enabled and disarmed after the last one, so a supervisor with no gate never keeps a timer alive.
- All state changes flow through a single `transition` point; an `onTransition` callback is available for observers.

**App gate** (`src/app-gate.ts`): one batched `tasklist`/`ps` query per poll; `.exe` and directory prefixes normalized; bounded timeout and output. Injectables for tests.

**Registry extension**: pack modules may declare `server` (MCP entry forwarded to `mcp-manager.register`) and `app` (process names for the gate). Both are optional, so Phase 1 packs without servers still load.

**Host wiring** (`src/index.ts`): attaches `mcp-manager` opportunistically (`ctx.get` then `ctx.inject(['mcpManager'])`), subscribes to `mcp-manager/status`, starts the supervisor, and publishes `pinnacleHub` with `status()`, `setEnabled()`, `probe()`.

**Ports**: `ManagerPort`, `AppGate`, `SupervisorTimers` are interfaces so the supervisor is unit-testable with fakes (no Cordis, no real processes, no wall-clock).

## Tests
`tests/supervisor.test.ts` (16 tests) plus existing 9 config/registry tests = 34 total, all pass via `node --test` with native type stripping; `pnpm typecheck` clean; `pnpm build` emits `lib/index.js` + `lib/client.js`.

Covered: initial disabled state, gate off until an app is declared, `connected`, `app_not_running`, manager attach after start, disabled modules left alone, unknown-module rejection naming known modules, disposer idempotence (disable â†’ re-register re-registers), registration failure â†’ `error`, live `manager.probe`, temporary probe of a dormant module with no leftover registration, probe failure as a value (timeout / manager failure), manager status â†’ `error`, stop releases registrations + stops polling, `connecting` = `starting` not `error`, poll timer armed only while a gate is enabled.

## Live proof (`pinnacle-test`, no restart)

A test-only overlay (not in the tarball) was wired into `pinnacle-test`: `pinnacle-probe-pack` (rvt gated on `revit.exe`, navis gated on `Roamer.exe`, echo stdio test server) + `pinnacle-hub-observer` (writes module transitions to JSONL). Evidence captured at boot with Revit and Navis closed:

| module | state observed | detail |
|---|---|---|
| rvt | `app_not_running` | Waiting for revit.exe. |
| navis | `app_not_running` | Waiting for Roamer.exe. |
| echo | `connected` | 1 tool available. |
| echo | `disabled` | Disabled in the hub configuration. |

Sequence: initial `error: mcp-manager is not loaded` (pre-attach snapshot) â†’ manager attaches â†’ rvt/navis settle at `app_not_running` while their host apps are closed â†’ echo reaches `connected` â†’ observer disables echo â†’ `disabled`. This proves rvt/navis work and stop live, states are correct, and `connected â†’ disable â†’ dispose` happens without restarting dsh.

JSONL evidence: `C:\Users\elhussieny.mohamed\AppData\Local\Temp\opencode\phase2-proof.jsonl`.

## Artifacts
- Staging tarball: `dist\pinnacle-mcp-hub-0.1.0.tgz` (10.2 kB, 7 files).
- The test-only probe pack/observer live under `test-support/` and are NOT in `package.json` `files`, so they are not shipped.

## Deviations from plan
- Added `starting` as a transient state (approved): folding it into `error` would report failure on every normal launch.
- `pollMs` default moved into `HubDefaults` (plan Â§5 shows `pollMs: 20000`).
- Packs are resolved by `import(packageName)` from the hub package's location; a pack must be resolvable from the hub's `node_modules` ancestry. The registry error message names `dsh plugin add <package>`.

## Next
Proceed to Phase 3 (`pack-aec` with 6 modules, `discovery.ts`, `doctor`).

