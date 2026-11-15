# Phase 8 â€” Extension Seams

**Date:** 2026-11-10  **Verdict:** PASS â€” current seams are documented; no agent system was added.

## Current server lifecycle seam

- `src/types.ts` defines the pack's `ServerEntry`: the command, arguments, environment, transport, and timeouts passed to DSH.
- `src/supervisor.ts` defines `ModuleSpec` and `ManagerPort`. `ManagerPort.register(name, entry)` returns a disposer. `Supervisor` owns module registration, app gating, status, enable/disable, probe, and cleanup when disabled or stopped.
- There is no `ServerHandle` type or object in this release. The closest current boundary is `ServerEntry` plus the registration disposer returned by the DSH manager. A future adapter may name a handle, but that is a design decision for a separately approved phase.

## Shared control surface

- `src/index.ts` builds and publishes `HubService` (`status`, `setEnabled`, `probe`, `doctor`, `audit`, and `backups`) over the same `Supervisor` and pack registry.
- The model-facing path is the single `aec_control` tool in `src/control.ts`. The tool delegates to `HubService`; write actions pass through the existing `tools/pre-execute` policy.
- The UI path is `pinnacleHubRemote` in `src/remote.ts` and the typed `HubClientRemote` in `src/client/remote.ts`. Read calls forward to `HubService`. UI writes call `tools.execute` with `aec_control`, so they re-enter the same policy before reaching the service.
- Commands and the UI therefore share the service and supervisor. The UI does not register or manage MCP processes by itself.

## Future Agent interface â€” design only

A separately authorized design may pass an Agent's role, system prompt, allowed tool subset, and memory through the DSH runtime. In this project, those are not Hub APIs: the Hub does not create agents, persist agent memory, or attach a manifest to a module. Any future Agent should invoke the shared `aec_control` surface and remain subject to the same policy. The DSH runtime, not this Hub, would own role prompts and memory.

## Scope and verification

- Documentation only. No `handle.ts`, manifest loader, Agent API, multi-instance support, or upstream source changes were added.
- Symbols and control flow above were checked in `src/types.ts`, `src/supervisor.ts`, `src/index.ts`, `src/control.ts`, `src/remote.ts`, and `src/client/remote.ts`.
- Phase 9 runtime and release verification is recorded in `docs/PHASE9-STATUS.md`.

