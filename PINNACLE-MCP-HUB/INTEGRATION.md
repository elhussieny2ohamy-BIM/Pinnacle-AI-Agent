# Upstream integration points

This page records the DSH interfaces the hub depends on and where each is used. It is a maintenance map for upgrades, not a claim that every upstream interface is stable.

| Integration | Hub files | Contract relied on | Verification |
| --- | --- | --- | --- |
| Cordis plugin row and bundle patch | `cordis.patch.yml`, `package.json`, `src/index.ts` | One bundle patch inserts the `pinnacle-mcp-hub` row; `apply(ctx, config)` is the host entry. | `scripts/verify.ps1` checks package metadata, patch row, and host entry. |
| MCP manager | `src/index.ts`, `src/supervisor.ts` | On supported DSH versions, `mcpManager.register(name, entry)` returns a disposer; `mcp-manager/status` reports connection changes. DSH `0.2.2-rc.1` no longer exposes this service/event, so dynamic Hub server supervision is unavailable there. | `src/supervisor.ts` contract checks and live profile acceptance in `docs/PHASE2-STATUS.md`; RC1 compatibility probe in `docs/PHASE9-STATUS.md`. |
| Tool registry and policy | `src/control.ts`, `src/index.ts`, `src/policy.ts` | `tools.register` registers `aec_control`; `tools/pre-execute` can allow, deny, cancel, or ask before dispatch. | `docs/PHASE5-STATUS.md`; `scripts/verify.ps1` checks the registered action surface. |
| Tool execution pipeline | `src/index.ts`, `src/remote.ts` | UI mutations re-enter `tools.execute` so they pass through the same pre-execute policy. | Live UI acceptance in `docs/PHASE6-STATUS.md`. |
| Typert remote protocol | `src/remote.ts`, `src/client/remote.ts`, `tsdown.config.ts` | Host and client bind a Typert namespace; the host protocol package is supplied by DSH and remains external to the build. | `pnpm typecheck`, `pnpm build`, and tarball UI acceptance. |
| DSH client loader and UI | `src/client/index.ts`, `src/client/HubPage.tsx`, `package.json` | Client output is a CJS factory loaded by the DSH browser module loader; DSH supplies the declared UI peers. | `pnpm build` and live UI acceptance in `docs/PHASE6-STATUS.md`. |
| AEC pack loader | `src/registry.ts`, `pack-aec/index.js` (separate package) | Hub imports the configured pack package and validates its `pack.modules` manifest. | `src/registry.ts`; verify the hub and pack tarballs are installed together in a profile. |

## Upgrade procedure

1. Read the DSH release notes and inspect the upstream types/source for each row above.
2. Run `scripts/verify.ps1` from the project checkout; its output names failed checks.
3. Run `pnpm typecheck`, `pnpm build`, and the focused live profile acceptance recorded in the phase docs. Do not infer a live contract from a successful build.
4. Update this table and the relevant phase record when a contract changes.
5. Keep upstream behavior changes out of this package. If an upstream fix is unavoidable, store a small, dated patch in `patches/` and identify its upstream version.

The verified runtime is DSH `0.2.2-alpha.3`. `engines.dsh` is bounded to `>=0.2.2-alpha.3 <0.2.2-rc.1`: the RC1 update removed the `mcpManager` service/event used by `Supervisor`. The plugin manager enforces this range and requires an explicit version exemption to run an unsupported release. The Typert protocol is an optional peer because the host runtime supplies it.

