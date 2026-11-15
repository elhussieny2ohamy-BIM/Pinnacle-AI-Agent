# Phase 4 â€” Commands and Model Control Status

**Date:** 2026-11-09  **Verdict:** PASS â€” live in `PINNACLE-test`.

## Scope
Implemented `aec_control` (the only model-facing tool), write-policy enforcement via `tools/pre-execute`, and audit logging. Commands `/aec`, `/aec discover`, `/aec enable\|disable`, `/aec probe`, `/aec doctor`, `/aec profile`, `/aec audit` map to `aec_control` actions.

## What was implemented

**`src/control.ts`** â€” `aecControlDefinition(hub)` builds the `aec_control` tool definition:
- **Name:** `aec_control` (the only model-facing tool; `writeMode` is never in the schema)
- **Actions:**
  - `status` â€” hub status summary (safe)
  - `list` â€” module table with states (safe)
  - `enable <module>` â€” enable a module (write, governed by writeMode)
  - `disable <module>` â€” disable a module (write, governed by writeMode)
  - `probe <module>` â€” clean probe of an MCP server connection (write, governed by writeMode)
  - `doctor` â€” full diagnosis (safe)
  - `discover` â€” discovery results with confidence (safe)
- Safe actions (`status`/`list`/`doctor`/`discover`) always allowed; write actions go through `tools/pre-execute`
- Audit records written for `enable`/`disable`/`probe`
- Unknown or missing actions return error results (never throw)

**`src/policy.ts`** â€” Write policy:
- `decide(writeMode, hasApproval)` â€” `deny` â†’ refuse, `confirm` â†’ ask (or refuse without approval service), `allow` â†’ permit
- `writePolicyListener(hubStatus, hasApproval)` â€” `tools/pre-execute` listener that routes `aec_control` calls through the decision
- Safe actions bypass policy; write actions (`enable`/`disable`/`probe`) are governed by hub's default `writeMode`

**`src/audit.ts`** â€” Audit logger:
- Writes JSONL to `~/.dsh/PINNACLE-hub/audit/YYYY-MM.jsonl`
- Fields: ts, session, agent, module, tool, decision, result, durationMs, detail, args (redacted)
- `auditWrite` / `auditRead(limit)` â€” append and read-back; filesystem errors swallowed (never breaks hub)
- Secret-like arg keys (`credential`, `password`, `secret`, `token`, `key`, `apikey`) redacted

**`src/index.ts`** â€” Wiring:
- Registers `aec_control` via `ctx.tools.register(aecControlDefinition(hub))`
- Registers write policy via `ctx.on('tools/pre-execute', writePolicyListener(...))`
- Policy disposer tied to fiber lifetime via `ctx.effect`
- `HubService` unchanged: `status()`, `setEnabled()`, `probe()`, `doctor()`

## Tests
69 tests across 8 suites, all pass via `node --test`:
- `tests/control.test.ts` (11) â€” tool actions, error handling
- `tests/policy.test.ts` (15) â€” decide, listener, argument parsing
- `tests/audit.test.ts` (4) â€” write/read, redaction, limits
- Plus existing 38 (config 9 + discovery 8 + doctor 5 + supervisor 16)
- `pnpm typecheck` clean; `pnpm build` emits `lib/index.js` + `lib/client.js`

## Live proof (`PINNACLE-test`, no restart)

Boot succeeded cleanly with pack-aec loaded. The `aec_control` tool was registered via `ctx.tools.register()` without error, and the write policy listener was attached via `ctx.on('tools/pre-execute')`. Previous Phase 3 evidence confirmed: 5/6 high confidence, rvt/navis at `app_not_running`, rhino at `connected`.

## Artifacts
- Staging tarball: `dist\PINNACLE-mcp-hub-0.1.0.tgz` (rebuilt with control/policy/audit)
- Test-only observer lives under `test-support/` (not in `package.json` `files`, not shipped)

## Deviations from plan
- `discover` is classified as safe (read-only, per Phase 3) rather than a write action â€” it never registers a server
- Per-module `writeMode` override not yet implemented; hub default `writeMode` applies to all modules (plan Â§5 shows per-module intent, deferred to a later phase)
- `destructive` classification not yet implemented (none of the `aec_control` actions are destructive)

## Next
Proceed to Phase 5 (backup before write) or Phase 6 (hub page UI).

