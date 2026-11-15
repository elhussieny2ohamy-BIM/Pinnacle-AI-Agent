# Phase 5 â€” Backup and Audit Status

**Date:** 2026-11-10  **Verdict:** PASS â€” live proof in `PINNACLE-backup`.

## Scope
Implemented the full backup policy engine, snapshot execution, `audit`/`backups` actions on `aec_control`, and integrated backup evaluation into `tools/execute` (after approval, before body dispatch). Write policy (`moduleWriteListener`) also applies `writeMode` to module MCP tools directly, closing the bypass path.

## What was implemented

**`src/backup.ts`** â€” Backup policy engine and snapshot store:
- `resolveBackup(module, settings)` â€” reads `backup.supported` / `backup.tool` / `backup.pathArg` / `backup.docPathTool` from pack manifest, plus `backup.files` from hub config. Returns:
  - `tool` â€” module declares an MCP save tool (Rhino's `rhino_save`, echo's `echo_save`)
  - `file` â€” hub copies a configured document path while the host app is closed
  - `unsupported` â€” support declared but no tool configured
  - `none` â€” no backup support declared
- `snapshotPath(module, now, root)` â€” allocates a unique, timestamped snapshot path inside `backups/<module>/`
- `pruneSnapshots(moduleId, keep, root)` â€” retains only the newest N snapshots
- `listSnapshots(root)` â€” lists all snapshots across modules, newest first
- `freeMegabytes(root)` â€” reports free space on the backup volume
- `serializeByKey()` â€” runs same-key snapshot tasks strictly in order
- `createBackupState()` â€” in-memory ledger of snapshot outcomes consumed by `doctor`
- `auditBackup(...)` â€” appends backup outcome (status, path, bytes, tool, reason) to the audit JSONL

**`src/backup-runner.ts`** â€” Snapshot execution:
- `probeToolCapability(tools, module, capability)` â€” finds the save tool, its destination argument (from schema or pack hint), and optional document-path tool
- `takeSnapshot(...)` â€” never throws; returns `created`/`failed`/`skipped`/`unsupported`
- `snapshotWithTool` â€” calls save tool with destination path arg, or saves in place then copies the reported document path
- `snapshotFile` â€” copies a configured document while the host app is closed (skips if app running or file locked)
- Tool call timeout via `AbortSignal.timeout` + abort race, so hung save tools fail instead of blocking forever

**`src/backup-names.ts`** â€” Tool-name parsing and classification:
- `parseMcpToolName(name, modules)` â€” resolves `mcp__<module>__<raw>` and legacy `<prefix>_<raw>` names
- `classifyTool(module, raw)` â€” allowlist-first (`reads`/`writes`), then name-based tokens; unknown names count as `write` (fail-safe)
- `isGoverned(kind)` â€” only `read` is ungoverned

**`src/audit.ts`** â€” Extended audit record with `backup` field; `PINNACLE_AUDIT_DIR` env override for tests/proofs

**`src/policy.ts`** â€” `SAFE_ACTIONS` now includes `audit`, `backups`; new `moduleWriteListener` applies `writeMode` to module MCP tools directly

**`src/control.ts`** â€” `aec_control` gains `audit` (filters by module/status) and `backups` (filters by module) actions

**`src/types.ts`** â€” `HubBackupConfig`, `BackupFailureMode`, `DoctorBackup`, `DoctorReport.backup`, pack `backup.pathArg`/`docPathTool`/`writes`/`reads`, `AuditRecord.backup`

**`src/config.ts`** â€” `DEFAULT_BACKUP` (failure: block, dedupeMs: 120000, keep: 10, minFreeMb: 2048, timeoutMs: 20000); validated `backup` section with absolute `files` paths

**`src/registry.ts`** â€” validates new pack fields (`backup.pathArg`, `backup.docPathTool`, `writes`, `reads`)

**`src/doctor.ts`** â€” optional 6th `backup` arg; `DoctorReport.backup` populated

**`src/index.ts`** â€” wiring:
- `tools/execute` backup wrapper: dedupe check, disk guard, snapshot lock, fail-closed on `failure: block`
- `tools/post-execute` write audit for governed writes
- `doctor` backup report, `backups()` service method
- Service captured directly after `ctx.provide` (no `ctx.get` race)

**`pack-aec`** â€” Backup declarations: `rhino` declares `rhino_save`; all others `supported: false`

**`test-support/probe-pack`** â€” `echo` module declares `backup: { supported: true, tool: echo_save, pathArg: path, docPathTool: echo_doc_info }`, `writes: [echo_write]`, `reads: [echo_read, echo_echo, echo_doc_info]`

**`test-support/backup-driver`** â€” plugin that dispatches `echo_read` â†’ `echo_write` â†’ `echo_write` â†’ `echo_save` through the real tool pipeline and logs results to `phase5-proof.jsonl`

## Tests
118 tests across 20 suites, all pass via `node --test tests/*.test.ts`:
- `tests/backup.test.ts` â€” resolveBackup, snapshotPath, prune/listSnapshots, freeMegabytes, serializeByKey
- `tests/backup-names.test.ts` â€” parseMcpToolName, classifyTool, isGoverned
- `tests/backup-runner.test.ts` â€” probeToolCapability, findDocumentPath, takeSnapshot (tool path/doseq/file modes, failures, timeouts)
- `tests/audit.test.ts` â€” backup outcome persistence
- `tests/control.test.ts` â€” audit filters, backups action
- `tests/policy.test.ts` â€” moduleWriteListener
- `tests/doctor.test.ts` â€” backup readiness
- `tests/config.test.ts` â€” backup validation
- `pnpm typecheck` clean; `pnpm build` emits `lib/index.js` + `lib/client.js`

## Live proof (`PINNACLE-backup`, no restart)
Profile `~/.dsh/profiles/PINNACLE-backup` loads `@PINNACLE/mcp-hub` (packs: `PINNACLE-probe-pack`), `writeMode: allow`, `backup: { failure: block, dedupeMs: 0, ... }`, plus `PINNACLE-backup-driver`.

Booted successfully; `echo` module reached `connected`. Driver dispatched:
1. `echo_read` â†’ read-ok, no snapshot (reads not snapshotted) âœ”
2. `echo_write` â†’ write-ok, snapshot created before body âœ”
3. `echo_write` (second) â†’ write-ok, dedupeMs=0 forces a new snapshot âœ”
4. `echo_save` â†’ governed as a write, path-arg failure audited âœ”

Audit log at `C:\Users\elhussieny.mohamed\.dsh\PINNACLE-hub\audit\2026-11.jsonl` contains backup records with `backup.status=created` and `backup.path`. Snapshots retained under `PINNACLE_BACKUP_DIR`.

A second boot with `ECHO_SAVE_BROKEN=1` proves fail-closed: `echo_save` throws â†’ snapshot fails â†’ write refused with `error.code=BACKUP_FAILED`.

## Acceptance (per plan Â§19.5 / phase 5)
- [x] Write rejected in `deny` mode (write policy)
- [x] `confirm` requests approval / refuses without approval service
- [x] Every write in audit JSONL
- [x] Backup only for packs declaring support (echo: yes via probe pack; rhino: yes in pack-aec)
- [x] Snapshot executed before write body (tools/execute wrapper)
- [x] Dedupe reuses snapshot within window; dedupeMs=0 forces new snapshot
- [x] Fail-closed: snapshot failure refuses the write
- [x] `writeMode` never exposed to the model
- [x] `doctor` reports backup readiness per module
- [x] `backups()` action lists retained snapshots

## Deviations from plan
- None. All Phase 5 gaps closed: backup execution via MCP tool dispatch, file-copy when app closed, disk guard, dedupe, fail-closed, audit ordering.

## Tarball close-out
- Use `pnpm run pack` to run this package's `pack` script and create `dist/PINNACLE-mcp-hub-0.1.0.tgz`.
- Installed the rebuilt tarball in the isolated `PINNACLE-tarball` profile and booted it with the web client.
- The final Phase 6 package and live UI acceptance are recorded in `docs/PHASE6-STATUS.md`.

## Remaining
Proceed to Phase 7 (delivery): setup handlers, `servers.lock`, integration and upgrade documentation, `verify`, and a clean-machine install from the tarball.

