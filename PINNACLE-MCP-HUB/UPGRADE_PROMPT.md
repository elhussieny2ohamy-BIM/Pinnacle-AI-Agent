# DSH upgrade prompt

Use this prompt after updating the local DeepSeek Harness checkout:

> Review `INTEGRATION.md`, `AGENTS.md`, and the latest DSH changelog. Compare every documented integration point against the current upstream source and types. Run `scripts/verify.ps1`, `pnpm typecheck`, and `pnpm build`. Report each broken contract with the upstream evidence and owning hub file. Fix only confirmed compatibility breaks with minimal changes, update `INTEGRATION.md` and the affected phase record, and rerun the affected checks. Preserve the write policy, the single model-facing `aec_control` tool, the one-row bundle patch, and the rule against editing unrelated MCP client configuration. Do not build agent features or publish to a network share. Summarize any live profile acceptance still required.

Before accepting a change, verify that `@deepseek-ai/dsh-typert-protocol` remains external and that the client artifact still matches the DSH browser loader contract.
