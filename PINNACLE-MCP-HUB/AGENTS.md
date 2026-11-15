# Agent guide

## Project map

- `src/index.ts` — host wiring, policy hooks, supervisor lifecycle, and hub service.
- `src/config.ts`, `src/registry.ts`, `src/types.ts` — config and pack contracts.
- `src/supervisor.ts`, `src/discovery.ts`, `src/doctor.ts` — module lifecycle and diagnosis.
- `src/policy.ts`, `src/backup.ts`, `src/backup-runner.ts`, `src/audit.ts` — write guard, optional snapshots, and audit trail.
- `src/control.ts`, `src/remote.ts`, `src/client/` — model control tool and human UI.
- `pack-aec/` — separate catalog package; machine-specific paths must come from environment overrides or standard per-user locations.
- `scripts/setup.ps1`, `scripts/setup/` — one PowerShell setup dispatcher and per-server handlers.
- `servers.lock` — observed/source version record. It is advisory and never blocks a setup.
- `INTEGRATION.md` — DSH upstream contract map; update it when an integration changes.

## Operating rules

1. Keep all writes guarded in `src/policy.ts`; UI write operations must re-enter `tools.execute`.
2. Keep `deny` as the default. Do not add a model-facing action that changes `writeMode`.
3. Never add credentials, user names, machine paths, or document paths to source, docs, lockfiles, logs, or release metadata.
4. Do not make setup handlers silently edit unrelated MCP client configuration. Revit uses `-Client none`; Civil 3D uses its Core-only component.
5. Preserve the one-row bundle patch and the single `aec_control` model-facing tool.
6. Avoid upstream edits. Document a narrowly scoped patch in `patches/` only when required.
7. `servers.lock` is record-and-warn; do not turn it into a version gate.
8. Keep installation commands explicit and per-user where upstream supports it. Run `-WhatIf` before changing setup behavior.
9. No agent system, manifest loader, or multi-instance support in this release.

## Change workflow

1. Read `INTEGRATION.md` and the relevant `docs/PHASE*-STATUS.md` before editing a DSH hook.
2. Keep changes within the smallest owning module and update the docs with observed behavior.
3. Run `scripts/verify.ps1`, `pnpm typecheck`, and `pnpm build` when changing the hub package. Run live profile acceptance when changing DSH host/client integration.
4. Never publish to the internal share from an agent session; prepare a release folder and request final approval for the copy.
