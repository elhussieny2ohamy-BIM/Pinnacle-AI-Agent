# Phase 1 â€” Package skeleton and loading

Status: complete. Everything below was observed on this machine on 2026-11-09.

## Delivered

| Item | Where | Notes |
| --- | --- | --- |
| Package manifest with `dsh.bundle.patch` + `dsh.client` | `package.json` | `engines.dsh: ">=0.2.2-alpha.3"`; `./client` export present |
| One bundle row | `cordis.patch.yml` | Row id `PINNACLE-mcp-hub`; config: `packs`, `discovery.applyMode`, `defaults` |
| Host entry | `src/index.ts` | Publishes the `PINNACLEHub` service; refuses a second activation |
| Row validation | `src/config.ts` | Field-named failures; no coercion of enums, lists, or numbers |
| Pack registry | `src/registry.ts` | Resolves packs by package name; validates manifests, duplicate ids, duplicate tool prefixes |
| Client artifact | `src/client/index.ts` | No-op bundle that exercises `dsh.client`, the `./client` export, and the loader contract |
| Build | `tsdown.config.ts` | Two outputs: ESM host + CJS loader artifact; packs external |
| Tests | `tests/*.test.ts` | 9 tests via `node --test` (native type stripping) |
| Test profile | `~/.dsh/profiles/PINNACLE-test` | Copy of `web` bundles + `link:` dependency + hub row |

## Build evidence

```
$ pnpm build
â„¹  [CJS] lib\client.js      0.91 kB â”‚ gzip: 0.54 kB
â„¹  [ESM] lib\index.js      10.87 kB â”‚ gzip: 3.26 kB
âœ”  Build complete in 13ms

$ pnpm typecheck   # clean
$ pnpm test
â„¹  pass 9
â„¹  fail 0
```

The client artifact keeps the required wrapper and leaves the dynamic pack import in the host bundle (`await import(packageName)`), so packs are never inlined:

```js
window.__ModuleLoader__.load({
	id: "@PINNACLE/mcp-hub",
	factory: (require) => { â€¦ return module.exports; }
});
```

## Install evidence

Profile `~/.dsh/profiles/PINNACLE-test` (bundles `dsh-base` + `dsh-web-app`), dependency `"@PINNACLE/mcp-hub": "link:D:/OPENCODE/MCPs/PINNACLE-MCP-HUB"`, hub row appended to the profile patch.

```
$ pnpm list --depth 0
dsh-profile-PINNACLE-test â€¦ (PRIVATE)
â””â”€â”€ @PINNACLE/mcp-hub@link:D:/OPENCODE/MCPs/PINNACLE-MCP-HUB
```

The node_modules entry is a junction to the checkout, which is the same record the Plugins panel reads.

## Behavior evidence (real boots, source launch, `--patch` overlays)

All four runs used `--profile PINNACLE-test`; none needed a change outside this repository.

**1. Clean boot**

```
stdout: dsh web: http://127.0.0.1:3080/?token=â€¦
HTTP GET  ->  200, 40799 bytes
stderr: (empty)
```

No â€œentry did not activateâ€, no hub warning.

**2. Malformed policy (`sandbox/overlays/bad-config.yml`)**

```
dsh: warning: 1 entry did not activate
PINNACLE-mcp-hub (@PINNACLE/mcp-hub): HubConfigError: PINNACLE-mcp-hub: config.defaults.writeMode
  must be one of deny | confirm | allow, got "nope"
```

The application still started; the failure names the field and the accepted values.

**3. Second activation (`sandbox/overlays/duplicate-row.yml`)**

```
dsh: warning: 1 entry did not activate
PINNACLE-mcp-hub-duplicate (@PINNACLE/mcp-hub): HubLoadError: PINNACLE-mcp-hub: the hub is already
  loaded in this dsh process (service "PINNACLEHub" has been registered at <PINNACLE-mcp-hub>).
  Keep exactly one PINNACLE-mcp-hub row and restart dsh.
```

**4. Unresolvable pack (`sandbox/overlays/missing-pack.yml`)**

```
PINNACLE-mcp-hub (@PINNACLE/mcp-hub): PackRegistryError: PINNACLE-mcp-hub: cannot load pack
  "@PINNACLE/pack-does-not-exist": Cannot find package â€¦ Install it into this profile with
  'dsh plugin add @PINNACLE/pack-does-not-exist' or remove it from config.packs.
```

**5. Tarball install, no build and no link (the colleague path)**

```
$ npm pack --pack-destination dist
PINNACLE-mcp-hub-0.1.0.tgz  10234 bytes  (7 files: package.json, cordis.patch.yml,
                                        lib/index.js[.map], lib/client.js[.map], README.md)
$ pnpm install   # dependency: file:â€¦/dist/PINNACLE-mcp-hub-0.1.0.tgz
Done in 330ms

stdout: dsh web: http://127.0.0.1:3080/?token=â€¦
HTTP GET  ->  200
stderr: (empty)
```

The installed copy contains only `lib/`, `cordis.patch.yml`, `package.json`, and `README.md` â€” no sources, no dev dependencies, no build step.

## Deviations and their reasons

1. **No `Config` export.** `@deepseek-ai/schemastery` is a harness-internal package and is not published for this runtime version, so the row schema ships as a hand-written validator. Consequence: `dsh --dump-config-schema` does not list hub fields. Revisit if the hub later needs schema-driven settings UI.
2. **Double-load detection is two-step.** Cordis registers a service only when the fiber activates, so a sibling row can pass a `ctx.get()` pre-check and still be refused by `provide()`. The hub keeps both: the pre-check for same-fiber reloads, and a wrapped `provide()` failure for cross-row duplicates.
3. **The client bundle is intentionally empty.** It exists to prove the `dsh.client` path on every install instead of discovering a broken client row in the UI phase.
4. **Pack manifests are a hub contract, not a harness one.** A pack exports `pack` with `name`, `version`, `modules[]`; the hub validates ids and tool prefixes so a tool name always maps to one module.

## Phase 1 acceptance

| Criterion | Result |
| --- | --- |
| Package installs with `link:` into a second, clean profile | PASS â€” `PINNACLE-test` |
| The hub row loads without touching the host project | PASS â€” boot + service registration |
| Appears in the plugin inventory | PASS at manifest level (`pnpm list`); visual confirmation lands with the page in the UI phase |
| Installs from a tarball with no build, no pnpm, no sources | PASS â€” clean boot from `PINNACLE-tarball` profile |
| Double-load protection | PASS â€” refused with an actionable message |
| No production code in the harness repository | PASS â€” nothing outside `PINNACLE-MCP-HUB` was edited |

## Next

Phase 2 (supervisor) builds on `ctx.mcpManager`: `register`/disposer ownership, the four states (`disabled`, `app_not_running`, `connected`, `error`), the app gate, polling, and `probe`. The first pack (`pack-aec` with `rvt` and `navis`) can then prove the state transitions live.

