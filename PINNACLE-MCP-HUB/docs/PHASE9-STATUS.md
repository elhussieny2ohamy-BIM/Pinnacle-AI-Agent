# Phase 9 â€” QA Status

**Date:** 2026-11-10  **Verdict:** Local acceptance PASS on DSH `0.2.2-alpha.3`; RC1 is deliberately excluded after an upstream contract break. Colleague-device acceptance remains open.

## Local acceptance on a disposable profile

The clean profile `pinnacle-phase9-clean` was installed from the versioned Hub and AEC tarballs. A temporary stdio fixture and observer were installed only in that profile; neither was added to the release.

| Scenario | Result | Evidence |
| --- | --- | --- |
| Clean install and Hub loader | PASS | Final clean replay installed `mcp-hub-0.1.3.tgz` and `pack-aec-0.1.3.tgz`; DSH web returned HTTP 200. Revit connected with 237 tools; Rhino 0.7.0 auto-detected the absent bridge and connected in standalone mode with 246 tools. The earlier fixture run connected with 5 tools. |
| Add server/module | PASS | Added the temporary `pinnacle-phase9-probe-pack`; `qa-echo` connected with five tools. |
| Disable and re-enable module | PASS | `qa-echo` transitioned `connected â†’ disabled â†’ starting â†’ connected`; the fixture process exited on disable and returned on enable. |
| Server crash and recovery | PASS | Terminated only the fixture process under this disposable profile. The Hub recorded `connection closed`, reconnected on attempt 2, and returned to `connected`. |
| DSH restart | PASS | Stopped and relaunched the isolated profile; the Hub and all six AEC module entries loaded again. Fixture state recovered before its removal. |
| Remove server/module | PASS | Removed the temporary pack from the profile, reinstalled/recomposed it, and restarted DSH. Final status contained the six AEC modules and no `qa-echo`; no fixture server process remained. |

## Upstream update experiment

The local checkout is DSH `0.2.2-alpha.3`. I cloned the official [DSH `0.2.2-rc.1` release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1) into a disposable directory, installed its frozen dependencies, and built the host and client libraries needed for a fair loader run. Its Hub activation succeeded, but all six modules settled at `error: mcp-manager is not loaded in this dsh process`; a source search confirmed RC1 no longer contains the `mcpManager` service or `mcp-manager/status` event.

This is a real upstream contract break. The Hub does not adapt itself to RC1 because that requires a new server-registration integration. Instead, `engines.dsh` is bounded to the last runtime verified by this project (`>=0.2.2-alpha.3 <0.2.2-rc.1`) so DSH refuses the incompatible bundle unless the user explicitly overrides the version check. No upstream files were edited. A future compatibility phase must design and test a replacement for the removed manager before this upper bound is widened.

## Checks and limits

- `pnpm test`: 118 passed, 20 suites, 0 failed.
- `pnpm typecheck`: passed.
- `scripts/verify.ps1`: passed with six setup handlers and six lock records.
- `scripts/setup/rhino.ps1 -Version 0.7.0 -WhatIf`: showed the expected install target without changing machine state.
- Rhino MCP initialize + tools/list smoke without a forced mode: server `rhino-mcp 1.30.0` detected no bridge, selected standalone mode, and returned 246 tools.
- `engines.dsh` range check: DSH `0.2.2-alpha.3` accepted; RC1 refused Hub `0.1.3` installation and rolled back the profile package/lockfile changes because the declared range excludes it.
- `scripts/package-release.ps1`: Hub and AEC tarballs packaged and verified with SHA-256 sidecars and `latest.json`.
- The UI page returned HTTP 200 on the local profile. The desktop app's browser is disabled by Work settings, so CUA could not inspect live rendered UI or browser console errors in this run.
- The colleague-device acceptance criterion was not executable here. It remains the sole external delivery check; this report does not claim it passed.

## Final status

Phase 9 local scenarios are complete. Overall roadmap acceptance is not 100%: a colleague must install the staged release, and the Hub needs a separately scoped DSH RC1 integration before its compatibility range can include RC1 or later.

