import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, statfsSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { bindTypertRemote } from "@deepseek-ai/dsh-typert-protocol";
// src/app-gate.ts
/**
* Process lookup for the app gate. The supervisor asks once per poll for every
* process name declared by an enabled module; this adapter answers from one
* system query instead of one query per application.
*
* Windows uses `tasklist`; other platforms fall back to `ps`. Both return raw
* process names, and the supervisor normalizes `.exe` and directory prefixes.
* @module @pinnacle/mcp-hub/src/app-gate
*/
/** Query budget; a hung process table must not stall the poll loop. */
const QUERY_TIMEOUT_MS = 5e3;
/** Bound the captured table so a pathological process list cannot exhaust memory. */
const MAX_BUFFER_BYTES = 4194304;
const execFileAsync = promisify(execFile);
/** Default runner: no shell, hidden window, bounded time and output. */
const defaultRunner = async (file, args) => {
	const { stdout } = await execFileAsync(file, [...args], {
		timeout: QUERY_TIMEOUT_MS,
		maxBuffer: MAX_BUFFER_BYTES,
		windowsHide: true
	});
	return stdout;
};
/** Strip a directory prefix and `.exe`, then lowercase. */
function normalizeProcessName$1(name) {
	return (name.replace(/\\/g, "/").split("/").pop() ?? name).toLowerCase().replace(/\.exe$/, "");
}
/** Parse `tasklist /FO CSV /NH`; the first CSV field is the image name. */
function parseTasklist(stdout) {
	const names = [];
	for (const line of stdout.split(/\r?\n/)) {
		const match = /^"([^"]+)"/.exec(line);
		if (match !== null) names.push(match[1]);
	}
	return names;
}
/** Parse `ps -eo comm=`; each line is a command name. */
function parsePs(stdout) {
	return stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}
/**
* Build the platform process gate.
* @param run - command runner, injectable for tests.
* @param platform - target platform; defaults to the running one.
* @returns a gate answering one batched query per call.
*/
function createSystemAppGate(run = defaultRunner, platform = process.platform) {
	const read = async () => {
		if (platform === "win32") return parseTasklist(await run("tasklist.exe", [
			"/FO",
			"CSV",
			"/NH"
		]));
		return parsePs(await run("ps", ["-eo", "comm="]));
	};
	return { async running(names) {
		const requested = new Set(names.map(normalizeProcessName$1));
		const present = /* @__PURE__ */ new Set();
		for (const name of await read()) {
			const normalized = normalizeProcessName$1(name);
			if (requested.has(normalized)) present.add(normalized);
		}
		return present;
	} };
}
// src/audit.ts
/**
* Audit logger for the PINNACLE MCP hub.
*
* Writes one JSONL record per write-relevant hub operation to
* `~/.dsh/pinnacle-hub/audit/YYYY-MM.jsonl` (or `PINNACLE_AUDIT_DIR` when set, which
* keeps tests and proofs off the user's real log). Each record carries the time,
* session, agent, module, tool, policy decision, result, and duration.
* Secret values are redacted before persistence.
* @module @pinnacle/mcp-hub/src/audit
*/
/** Fields redacted from audit records. */
const REDACTED_FIELDS = /* @__PURE__ */ new Set([
	"credential",
	"password",
	"secret",
	"token",
	"key",
	"apikey",
	"api-key"
]);
/** Redact secret-like values from an unknown JSON value. */
function redact(value) {
	if (value === null || value === void 0) return value;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value)) return value.map(redact);
	if (typeof value === "object") {
		const result = {};
		for (const [key, val] of Object.entries(value)) {
			const lower = key.toLowerCase();
			result[key] = REDACTED_FIELDS.has(lower) || lower.includes("credential") ? "[redacted]" : redact(val);
		}
		return result;
	}
	return value;
}
/** Resolve the monthly audit directory, honoring the `PINNACLE_AUDIT_DIR` override. */
function auditDir() {
	const dir = process.env.PINNACLE_AUDIT_DIR ?? join(homedir(), ".dsh", "pinnacle-hub", "audit");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}
/** Resolve the monthly audit file path under the dsh home directory. */
function auditFilePath(month) {
	return join(auditDir(), `${month}.jsonl`);
}
/**
* Append one audit record to the current month's JSONL file.
* @param record - the audit record to persist.
*/
function auditWrite(record) {
	try {
		const now = /* @__PURE__ */ new Date();
		const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
		const line = JSON.stringify({
			ts: record.ts,
			...record.session !== void 0 ? { session: record.session } : {},
			...record.agent !== void 0 ? { agent: record.agent } : {},
			module: record.module,
			tool: record.tool,
			decision: record.decision,
			result: record.result,
			durationMs: record.durationMs,
			...record.detail !== void 0 ? { detail: record.detail } : {},
			...record.args !== void 0 ? { args: redact(record.args) } : {},
			...record.backup !== void 0 ? { backup: record.backup } : {}
		});
		appendFileSync(auditFilePath(month), line + "\n", { encoding: "utf8" });
	} catch {}
}
/** Last N audit records across monthly files, newest first. */
function auditRead(limit) {
	const records = [];
	const dir = auditDir();
	try {
		const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().reverse();
		for (const file of files) {
			if (records.length >= limit) break;
			const content = readFileSync(join(dir, file), "utf8");
			for (const line of content.split(/\r?\n/)) {
				if (line.trim().length === 0) continue;
				try {
					records.push(JSON.parse(line));
					if (records.length >= limit) break;
				} catch {}
			}
		}
	} catch {}
	return records.slice(0, limit);
}
// src/backup.ts
/**
* Backup policy and snapshot store for the PINNACLE MCP hub.
*
* Resolves how one module can snapshot its document before a write:
* - `tool`: the module's MCP server exposes a save tool (Rhino's `rhino_save`).
* - `file`: the hub copies a configured document while the host app is closed.
* - `unsupported` / `none`: no snapshot is possible.
*
* The store lives under `~/.dsh/pinnacle-hub/backups/<module>/`, prunes to a
* configured count, and refuses to run below a free-space floor. Every attempt
* is audited with the resulting path, size, and reason.
* @module @pinnacle/mcp-hub/src/backup
*/
/** Root directory for every snapshot. An env override keeps tests off the real profile. */
function backupRoot() {
	return process.env.PINNACLE_BACKUP_DIR ?? join(homedir(), ".dsh", "pinnacle-hub", "backups");
}
/** Create the in-memory ledger used by the current process. */
function createBackupState() {
	const events = /* @__PURE__ */ new Map();
	return {
		record: (moduleId, event) => {
			events.set(moduleId, event);
		},
		last: (moduleId) => events.get(moduleId)
	};
}
/**
* Resolve a module's snapshot capability.
* @param module - validated pack module.
* @param settings - the hub's backup policy.
* @returns the capability; `none` means no snapshot is expected.
*/
function resolveBackup(module, settings) {
	if (module.backup.supported) {
		if (module.backup.tool === void 0) return {
			kind: "unsupported",
			reason: "Module declares backup support but no backup tool is configured."
		};
		return {
			kind: "tool",
			tool: module.backup.tool,
			...module.backup.pathArg === void 0 ? {} : { pathArg: module.backup.pathArg },
			...module.backup.docPathTool === void 0 ? {} : { docPathTool: module.backup.docPathTool }
		};
	}
	const file = settings.files[module.id];
	if (file !== void 0) return {
		kind: "file",
		source: file
	};
	return {
		kind: "none",
		reason: "Module does not declare backup support and no document file is configured."
	};
}
/** Extension used for a snapshot of a module's document. */
function snapshotExtension(module) {
	if ((module.backup.tool ?? "").includes("rhino") || module.id === "rhino") return ".3dm";
	if (module.id === "rvt") return ".rvt";
	if (module.id === "autocad" || module.id === "civil3d") return ".dwg";
	return ".bak";
}
/** Directory for one module's snapshots. */
function moduleBackupDir(moduleId, root = backupRoot()) {
	return join(root, moduleId);
}
/** Whether a path stays inside the backup root (no traversal from module ids). */
function insideRoot(candidate, root) {
	const normalized = candidate.toLowerCase().replace(/\\/g, "/");
	const base = root.toLowerCase().replace(/\\/g, "/").replace(/\/$/, "");
	return normalized === base || normalized.startsWith(`${base}/`);
}
/**
* Allocate a unique snapshot path for a module.
* @param module - the module being snapshotted.
* @param now - timestamp used in the name (tests pin it).
* @param root - backup root override.
* @returns an absolute path whose parent directory exists.
*/
function snapshotPath(module, now = /* @__PURE__ */ new Date(), root = backupRoot()) {
	const dir = moduleBackupDir(module.id, root);
	mkdirSync(dir, { recursive: true });
	const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
	const ext = snapshotExtension(module);
	let candidate = join(dir, `${stamp}${ext}`);
	let counter = 1;
	while (existsSync(candidate)) {
		candidate = join(dir, `${stamp}-${counter}${ext}`);
		counter += 1;
	}
	if (!insideRoot(candidate, root)) throw new Error(`snapshot path escapes the backup root: ${candidate}`);
	return candidate;
}
/**
* Free space on the volume holding the backup root.
* @param root - backup root override.
* @returns free megabytes, or Infinity when the platform cannot report it.
*/
function freeMegabytes(root = backupRoot()) {
	try {
		mkdirSync(root, { recursive: true });
		const stats = statfsSync(root);
		return stats.bavail * stats.bsize / 1048576;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}
/** List snapshot files across every module, newest first. */
function listSnapshots(root = backupRoot()) {
	const result = [];
	let modules;
	try {
		modules = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch {
		return result;
	}
	for (const module of modules) {
		const dir = join(root, module);
		let files;
		try {
			files = readdirSync(dir);
		} catch {
			continue;
		}
		for (const file of files) {
			const path = join(dir, file);
			try {
				const stats = statSync(path);
				if (!stats.isFile()) continue;
				result.push({
					module,
					path,
					bytes: stats.size,
					modifiedAt: stats.mtime.toISOString()
				});
			} catch {}
		}
	}
	return result.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
/**
* Delete the oldest snapshots beyond the retention count.
* @param moduleId - the module whose directory is pruned.
* @param keep - snapshots to retain.
* @param root - backup root override.
* @returns how many files were removed.
*/
function pruneSnapshots(moduleId, keep, root = backupRoot()) {
	const dir = moduleBackupDir(moduleId, root);
	let files;
	try {
		files = readdirSync(dir).map((name) => ({
			name,
			mtime: statSync(join(dir, name)).mtimeMs
		})).filter((entry) => entry.mtime > 0).sort((a, b) => b.mtime - a.mtime).map((entry) => entry.name);
	} catch {
		return 0;
	}
	let removed = 0;
	for (const file of files.slice(keep)) {
		const path = join(dir, file);
		if (!insideRoot(path, root)) continue;
		try {
			unlinkSync(path);
			removed += 1;
		} catch {}
	}
	return removed;
}
/** Run tasks for one key strictly in order. */
function serializeByKey() {
	const chains = /* @__PURE__ */ new Map();
	return async (key, task) => {
		const next = (chains.get(key) ?? Promise.resolve()).then(task, task);
		chains.set(key, next.catch(() => void 0));
		try {
			return await next;
		} finally {
			if (chains.get(key) === next || chains.get(key) === void 0) chains.delete(key);
		}
	};
}
/**
* Append one snapshot outcome to the audit log.
* @param module - module id.
* @param tool - public tool name that triggered the snapshot.
* @param event - the outcome.
* @param durationMs - wall-clock duration.
* @param outcome - whether the write was allowed to continue.
*/
function auditBackup(module, tool, event, durationMs, outcome) {
	let decision;
	let result;
	if (outcome === "refused") {
		decision = "deny";
		result = "refused";
	} else if (event.status === "failed") {
		decision = "allow";
		result = "failed";
	} else {
		decision = "allow";
		result = "ok";
	}
	auditWrite({
		ts: event.at,
		module,
		tool,
		decision,
		result,
		durationMs,
		...event.reason === void 0 ? {} : { detail: event.reason },
		backup: {
			status: event.status,
			...event.path === void 0 ? {} : { path: event.path },
			...event.bytes === void 0 ? {} : { bytes: event.bytes },
			...event.tool === void 0 ? {} : { tool: event.tool },
			...event.reason === void 0 ? {} : { reason: event.reason }
		}
	});
}
// src/backup-names.ts
/** Tokens that identify a mutation regardless of server naming style. */
const WRITE_TOKENS = /* @__PURE__ */ new Set([
	"save",
	"saveas",
	"create",
	"add",
	"update",
	"delete",
	"remove",
	"modify",
	"move",
	"copy",
	"insert",
	"draw",
	"write",
	"import",
	"export",
	"apply",
	"edit",
	"rename",
	"purge",
	"reload",
	"publish",
	"assign",
	"link",
	"place",
	"load",
	"open",
	"close",
	"new",
	"set",
	"clear",
	"reset",
	"run",
	"execute",
	"send",
	"post",
	"put",
	"patch",
	"upload",
	"download",
	"sync",
	"merge",
	"split",
	"trim",
	"extrude",
	"revolve",
	"sweep",
	"loft",
	"fillet",
	"chamfer",
	"boolean",
	"mirror",
	"array",
	"offset",
	"scale",
	"rotate",
	"translate",
	"transform",
	"convert",
	"bake",
	"commit",
	"push",
	"duplicate",
	"batch"
]);
/** Tokens that only read state. */
const READ_TOKENS = /* @__PURE__ */ new Set([
	"get",
	"list",
	"info",
	"read",
	"query",
	"show",
	"status",
	"find",
	"search",
	"count",
	"describe",
	"ping",
	"health",
	"inspect",
	"enumerate",
	"view",
	"stats",
	"report",
	"check",
	"measure",
	"calculate",
	"compute",
	"version"
]);
/** Split a tool name into lowercase word tokens. */
function tokenize(raw) {
	return raw.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0);
}
/**
* Resolve a public tool name to its module.
* @param name - the registered tool name.
* @param modules - every loaded module keyed by module id.
* @returns the module id and raw tool name, or undefined when the tool is not module-owned.
*/
function parseMcpToolName(name, modules) {
	const namespaced = /^mcp__([A-Za-z0-9_-]{1,32})__(.+)$/.exec(name);
	if (namespaced !== null) {
		const moduleId = namespaced[1];
		const raw = namespaced[2];
		return modules.has(moduleId) ? {
			moduleId,
			raw
		} : void 0;
	}
	let best;
	let bestLength = 0;
	for (const module of modules.values()) {
		const prefix = `${module.toolPrefix}_`;
		if (name.startsWith(prefix) && name.length > prefix.length && prefix.length > bestLength) {
			best = {
				moduleId: module.id,
				raw: name.slice(prefix.length)
			};
			bestLength = prefix.length;
		}
	}
	return best;
}
/**
* Classify one raw tool name for a module.
* @param module - the owning module declaration.
* @param raw - tool name without the `mcp__<module>__` namespace.
* @returns the classification; unknown names count as writes.
*/
function classifyTool(module, raw) {
	if (module.backup.tool === raw) return "backup";
	if (module.reads?.includes(raw) === true) return "read";
	if (module.writes?.includes(raw) === true) return "write";
	const tokens = tokenize(raw);
	const write = tokens.some((token) => WRITE_TOKENS.has(token));
	const read = tokens.some((token) => READ_TOKENS.has(token));
	if (write) return "write";
	if (read) return "read";
	return "unknown";
}
// src/remote.ts
/**
* Host-side Typert remote for the PINNACLE MCP hub.
*
* Exposes the hub service's read-only and write-governed methods to the web
* client so the Modules and Doctor screens can toggle modules, probe servers,
* and read status/doctor/backups without touching the terminal. The remote is
* constructed by the hub's `apply` and registers itself as a Cordis service
* plus a Typert Gateway binding under the `pinnacleHub` namespace.
*
* Write actions (`enable`, `disable`, `probe`) remain governed by the hub's
* `writeMode` policy â€” the remote enforces nothing itself, it simply forwards
* to the hub service which applies policy through `tools/pre-execute`.
* @module @pinnacle/mcp-hub/src/remote
*/
const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";
/** Cordis service key under which the remote registers. Not the Typert namespace. */
const REMOTE_SERVICE_KEY = "pinnacleHubRemote";
/** Typert Gateway namespace clients call into: `ctx.remote.pinnacleHub.<method>()`. */
const REMOTE_NAMESPACE = "pinnacleHub";
/** Register one method as a direct Remote endpoint on the class prototype. */
function markRemoteMethod(prototype, method) {
	const descriptor = prototype[REMOTE_METHOD_DESCRIPTOR];
	const marker = Object.freeze({
		method,
		invocation: Object.freeze({ kind: "direct" })
	});
	const current = descriptor?.methods.find((c) => c.method === method);
	if (current !== void 0 && current.exportName === marker.exportName) return;
	Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
		configurable: true,
		value: Object.freeze({
			version: 1,
			methods: Object.freeze([...descriptor?.methods ?? [], marker])
		})
	});
}
/**
* Host remote forwarding hub service calls to the Typert Gateway.
* Constructed by {@link apply} in {@link ./index.ts}; not registered as a
* separate cordis.patch.yml row to avoid a duplicate-service conflict with the
* hub's own `pinnacleHub` provision.
* @module @pinnacle/mcp-hub/src/remote
*/
var pinnacleHubRemote = class {
	hub;
	runControlAction;
	constructor(hub, runControlAction) {
		this.hub = hub;
		this.runControlAction = runControlAction;
		const gatewayBinding = bindTypertRemote(this, REMOTE_SERVICE_KEY, { namespace: REMOTE_NAMESPACE });
		this.typertRemote = gatewayBinding;
		const proto = Object.getPrototypeOf(this);
		markRemoteMethod(proto, "status");
		markRemoteMethod(proto, "setEnabled");
		markRemoteMethod(proto, "probe");
		markRemoteMethod(proto, "doctor");
		markRemoteMethod(proto, "backups");
		markRemoteMethod(proto, "audit");
	}
	/** Hub status summary: started config, packs, module states. Safe. */
	status() {
		return Promise.resolve(this.hub.status());
	}
	/** Enable or disable one module; governed by writeMode. */
	async setEnabled(id, enabled) {
		const action = enabled ? "enable" : "disable";
		return await this.runWriteAction(action, id);
	}
	/** Probe one module's MCP server; a failed probe is a value, not a throw. */
	async probe(id) {
		return await this.runWriteAction("probe", id);
	}
	/** Full diagnosis: modules, backup readiness, environment issues. Safe. */
	doctor() {
		return this.hub.doctor();
	}
	/** Retained snapshots per module. Safe. */
	backups() {
		return this.hub.backups();
	}
	/** Last N audit records, optionally filtered by module/result. Safe. */
	audit(limit) {
		return this.hub.audit(limit);
	}
	/** Route every UI write through the same pre-execute policy as aec_control. */
	async runWriteAction(action, id) {
		const result = await this.runControlAction(action, id);
		if (result === void 0 || result === null || typeof result !== "object" || !("data" in result)) throw new Error(`The hub returned no result for ${action}.`);
		if (result.ok !== true && action !== "probe") throw new Error(typeof result.data === "string" ? result.data : `The hub could not ${action} ${id}.`);
		return result.data;
	}
};
// src/message.ts
/**
* One message extractor for unknown thrown values, so every hub failure reports
* the same way whether it came from Node, from a pack, or from Cordis.
* @module @pinnacle/mcp-hub/src/message
*/
/**
* Read a printable message from an unknown thrown value.
* @param error - any value a `catch` block received.
* @returns the error's message, or the value's string form for non-errors.
*/
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
// src/backup-runner.ts
/**
* Snapshot execution for the PINNACLE MCP hub.
*
* Two sources, decided by {@link resolveBackup}:
* - an MCP save tool that either writes straight to the snapshot path or saves
*   in place while a document-info tool reports the file to copy;
* - a configured document file the hub copies while the host app is closed.
*
* Tool calls go through the registry's own definitions, so the backup runs on
* the connection the supervisor already owns â€” no second MCP process.
* @module @pinnacle/mcp-hub/src/backup-runner
*/
/** Extension pattern for a document path found in a tool result. */
const DOCUMENT_PATTERN = /\.(3dm|rvt|rfa|dwg|dxf|skp|nwd|nwc)$/i;
/** Public MCP name for a module's raw tool. */
function publicName(moduleId, raw) {
	return `mcp__${moduleId}__${raw}`;
}
/** Read an object schema's property names without trusting its shape. */
function propertyNames(schema) {
	if (schema === void 0) return [];
	const properties = schema.properties;
	if (typeof properties !== "object" || properties === null) return [];
	return Object.keys(properties);
}
/** Find a save-tool argument that names the destination. */
function detectPathParam(schema) {
	const names = propertyNames(schema);
	const exact = names.find((name) => /^(path|file|filepath|file_path|filename|filename_path|save_path|output|output_path|destination)$/i.test(name));
	if (exact !== void 0) return exact;
	return names.find((name) => /path|file|filename|destination|output/i.test(name)) ?? null;
}
/** Find a read-only tool that reports the current document path. */
function detectDocPathTool(tools, moduleId, hinted) {
	if (hinted !== void 0) {
		const hintedTool = tools.executable(publicName(moduleId, hinted));
		if (hintedTool !== void 0) return hintedTool;
	}
	for (const tool of tools.definitions?.() ?? []) {
		const prefix = `mcp__${moduleId}__`;
		if (!tool.name.startsWith(prefix)) continue;
		const raw = tool.name.slice(prefix.length);
		if (/(document|drawing|model|file).*(info|path)/i.test(raw) || /^(get|current).*(document|drawing|model|file)/i.test(raw)) return tool;
	}
	return null;
}
/**
* Probe how a module's save tool takes a snapshot.
* @param tools - registry surface, or undefined when no tool service exists.
* @param module - owning module.
* @param capability - the resolved `tool` capability.
* @returns the save tool, destination argument, and optional document-info tool.
*/
function probeToolCapability(tools, module, capability) {
	if (tools === void 0) return {
		saveTool: null,
		pathParam: null,
		docPathTool: null
	};
	const saveTool = tools.executable(publicName(module.id, capability.tool)) ?? null;
	return {
		saveTool,
		pathParam: capability.pathArg ?? detectPathParam(saveTool?.parameters),
		docPathTool: detectDocPathTool(tools, module.id, capability.docPathTool)
	};
}
/** Recursively find the first document-looking path in a tool result. */
function findDocumentPath(value) {
	if (typeof value === "string") return DOCUMENT_PATTERN.test(value) ? value : null;
	if (Array.isArray(value)) {
		for (const entry of value) {
			const found = findDocumentPath(entry);
			if (found !== null) return found;
		}
		return null;
	}
	if (typeof value === "object" && value !== null) for (const entry of Object.values(value)) {
		const found = findDocumentPath(entry);
		if (found !== null) return found;
	}
	return null;
}
/** Reject when the budget or the caller aborts, even if a tool ignores its signal. */
function abortWith(signal) {
	return new Promise((_resolve, reject) => {
		const fail = () => reject(new Error(signal.reason instanceof Error ? signal.reason.message : "backup call aborted"));
		if (signal.aborted) {
			fail();
			return;
		}
		signal.addEventListener("abort", fail, { once: true });
	});
}
/** Call one tool with a budget and the caller's cancellation. */
async function callTool(tool, args, timeoutMs, signal) {
	const timeout = AbortSignal.timeout(timeoutMs);
	const combined = signal === void 0 ? timeout : AbortSignal.any([signal, timeout]);
	if (combined.aborted) throw new Error("cancelled before the backup started");
	return Promise.race([tool.execute(args, {
		signal: combined,
		name: tool.name,
		arguments: args
	}), abortWith(combined)]);
}
/** Size of a completed file, or undefined when it did not appear. */
function fileSize(path) {
	try {
		const stats = statSync(path);
		return stats.isFile() ? stats.size : void 0;
	} catch {
		return;
	}
}
/** Whether a file is currently held open for writing by another process. */
function isLocked(path) {
	try {
		closeSync(openSync(path, "r+"));
		return false;
	} catch (error) {
		const code = error.code;
		return code === "EBUSY" || code === "EPERM";
	}
}
/** Snapshot through an MCP save tool. */
async function snapshotWithTool(module, capability, tools, destination, timeoutMs, signal) {
	const probe = probeToolCapability(tools, module, capability);
	if (probe.saveTool === null) return {
		status: "unsupported",
		reason: `Backup tool ${capability.tool} is not registered; is the module connected?`
	};
	if (probe.pathParam !== null) {
		await callTool(probe.saveTool, { [probe.pathParam]: destination }, timeoutMs, signal);
		const bytes = fileSize(destination);
		if (bytes === void 0) return {
			status: "failed",
			reason: `Save tool reported success but ${destination} was not written.`,
			tool: capability.tool
		};
		return {
			status: "created",
			path: destination,
			bytes,
			tool: capability.tool
		};
	}
	if (probe.docPathTool === null) return {
		status: "unsupported",
		reason: `Cannot snapshot ${module.id}: ${capability.tool} accepts no destination and no document-path tool is available.`,
		tool: capability.tool
	};
	await callTool(probe.saveTool, {}, timeoutMs, signal);
	const source = findDocumentPath(await callTool(probe.docPathTool, {}, timeoutMs, signal));
	if (source === null) return {
		status: "unsupported",
		reason: "Document-path tool returned no recognizable path.",
		tool: capability.tool
	};
	if (!existsSync(source)) return {
		status: "failed",
		reason: `Document path reported by the server does not exist: ${source}`,
		tool: capability.tool
	};
	copyFileSync(source, destination);
	return {
		status: "created",
		path: destination,
		bytes: fileSize(destination) ?? 0,
		tool: capability.tool
	};
}
/** Snapshot a configured file while the host application is closed. */
function snapshotFile(capability, destination, appRunning) {
	if (appRunning) return {
		status: "skipped",
		reason: "Host application is running; the hub only copies a closed document."
	};
	if (!existsSync(capability.source)) return {
		status: "failed",
		reason: `Configured document does not exist: ${capability.source}`
	};
	if (isLocked(capability.source)) return {
		status: "skipped",
		reason: "Configured document is locked by another process."
	};
	copyFileSync(capability.source, destination);
	return {
		status: "created",
		path: destination,
		bytes: fileSize(destination) ?? 0
	};
}
/**
* Take one snapshot for a module. Never throws: every failure becomes a
* {@link SnapshotOutcome} the caller audits and acts on.
* @param module - owning module.
* @param capability - resolved `tool` or `file` capability.
* @param tools - registry surface for tool-backed snapshots.
* @param settings - backup policy (timeout).
* @param destination - absolute snapshot path.
* @param appRunning - whether the module's host application is running.
* @param signal - caller cancellation.
* @returns the outcome, including the snapshot path and size on success.
*/
async function takeSnapshot(module, capability, tools, settings, destination, appRunning, signal) {
	try {
		if (capability.kind === "file") return snapshotFile(capability, destination, appRunning);
		return await snapshotWithTool(module, capability, tools, destination, settings.timeoutMs, signal);
	} catch (error) {
		return {
			status: "failed",
			reason: errorMessage(error)
		};
	}
}
// src/discovery.ts
/**
* Discovery engine: scans the current machine for each pack module's MCP server
* and host application, then assigns a confidence and evidence per module.
*
* Discovery is read-only: it never registers a server with `mcp-manager`. The
* supervisor owns registration; discovery only reports what can be found and
* how confidently. Results are meant for the `/aec discover` confirmation table
* and for `doctor`.
* @module @pinnacle/mcp-hub/src/discovery
*/
/** Check whether a path exists on disk. */
function pathExists(path) {
	try {
		statSync(path);
		return true;
	} catch {
		return false;
	}
}
/**
* Resolve one path pattern to an existing file path.
* A plain path is returned as-is when it exists. A pattern containing a single
* `*` is treated as a directory glob: every directory beneath the part before
* `*` is checked for the part after `*`, and the highest directory name wins.
* This is used for Navisworks `versions\*\NavisHelper.McpServer.exe`.
*/
function resolveGlob(pattern) {
	const starIdx = pattern.indexOf("*");
	if (starIdx === -1) return pathExists(pattern) ? pattern : null;
	const dirPart = pattern.slice(0, starIdx);
	const rest = pattern.slice(starIdx + 1);
	let best = null;
	try {
		for (const entry of readdirSync(dirPart, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			if (pathExists(join(dirPart, entry.name, rest)) && (best === null || entry.name > best)) best = entry.name;
		}
	} catch {}
	return best === null ? null : join(dirPart, best, rest);
}
/** Resolve the first existing server path from a module's discovery hints. */
function resolveCommand(serverPaths) {
	if (!serverPaths) return null;
	for (const pattern of serverPaths) {
		const resolved = resolveGlob(pattern);
		if (resolved !== null) return resolved;
	}
	return null;
}
/** Check whether any host-application install marker exists on disk. */
function checkAppInstalled(appPaths) {
	if (!appPaths) return false;
	return appPaths.some(pathExists);
}
/** Classify confidence from discovery facts. */
function classify(requiresApp, commandResolved, appInstalled, unsupported) {
	if (unsupported) return "none";
	if (!requiresApp) return commandResolved ? "high" : "low";
	if (commandResolved && appInstalled) return "high";
	if (commandResolved || appInstalled) return "medium";
	return "low";
}
/** Build human-readable evidence for one discovery result. */
function buildEvidence(module, command, appInstalled, appRunning, confidence, unsupported) {
	const evidence = [];
	if (unsupported) {
		evidence.push(`Marked unsupported: ${module.discovery === void 0 ? "no reason recorded" : "pack declares unsupported"}`);
		return evidence;
	}
	if (command !== null) evidence.push(`Server executable found at ${command}`);
	else evidence.push(`No server executable found at any known discovery path`);
	if (module.requiresApp) {
		if (appInstalled) evidence.push(`Host application install markers found`);
		else evidence.push(`No host application install marker found`);
		evidence.push(appRunning ? "Host application process is running" : "Host application process is not running");
	} else evidence.push("Standalone mode: host application not required");
	evidence.push(`Confidence: ${confidence}`);
	return evidence;
}
/**
* Discover one module per entry in `modules`.
* @param modules - validated pack modules from the registry.
* @param appGate - optional process gate; when absent, `appRunning` is always false.
* @returns discovery results in the same order as `modules`.
*/
async function discoverModules(modules, appGate) {
	const requested = /* @__PURE__ */ new Set();
	for (const module of modules) if (module.app?.processNames.length) for (const name of module.app.processNames) requested.add(name);
	let running = /* @__PURE__ */ new Set();
	if (appGate !== void 0 && requested.size > 0) running = new Set(await appGate.running([...requested]));
	const runningNorm = new Set([...running].map(normalizeProcessName$1));
	const results = [];
	for (const module of modules) {
		const command = resolveCommand(module.discovery?.serverPaths);
		const appInstalled = checkAppInstalled(module.discovery?.appPaths);
		const appRunning = module.app ? module.app.processNames.some((name) => runningNorm.has(normalizeProcessName$1(name))) : false;
		const unsupported = module.discovery?.unsupported === true;
		const confidence = classify(module.requiresApp, command !== null, appInstalled, unsupported);
		results.push({
			id: module.id,
			title: module.title,
			requiresApp: module.requiresApp,
			command,
			appInstalled,
			appRunning,
			confidence,
			evidence: buildEvidence(module, command, appInstalled, appRunning, confidence, unsupported),
			unsupported
		});
	}
	return results;
}
// src/doctor.ts
/** Known internal ports per module, used to detect port conflicts. */
const MODULE_PORTS = {
	civil3d: 8080,
	sketchup: 9876
};
/** Build per-module diagnosis from discovery + supervision state. */
function buildModules(packs, discovery, statuses) {
	const byDiscovery = new Map(discovery.map((d) => [d.id, d]));
	const byStatus = new Map(statuses.map((s) => [s.id, s]));
	const modules = [];
	for (const pack of packs) for (const module of pack.modules) {
		const found = byDiscovery.get(module.id);
		const status = byStatus.get(module.id);
		const issues = [];
		const command = found === void 0 ? null : found.command;
		const appInstalled = found === void 0 ? false : found.appInstalled;
		const appRunning = found === void 0 ? false : found.appRunning;
		const confidence = found === void 0 ? "none" : found.confidence;
		const unsupported = found === void 0 ? false : found.unsupported;
		if (unsupported) issues.push("Module is unsupported on this machine; see discovery evidence.");
		if (command === null) issues.push("No MCP server command resolved; cannot register or connect.");
		else if (module.requiresApp && !appInstalled) issues.push("Host application not installed; command alone is not sufficient.");
		if (module.requiresApp && !appRunning) issues.push("Host application is not running; module will stay app_not_running.");
		if (status === void 0) issues.push("Module is not tracked by the supervisor (no server entry in pack).");
		else if (status.state === "error") issues.push(`Supervision error: ${status.detail}`);
		else if (status.state === "app_not_running") issues.push("Waiting for the host application to start.");
		modules.push({
			id: module.id,
			title: module.title,
			confidence,
			state: status === void 0 ? "disabled" : status.state,
			detail: status === void 0 ? "Not registered with the supervisor." : status.detail,
			command,
			appInstalled,
			appRunning,
			unsupported,
			issues
		});
	}
	return modules;
}
/** Check for known port conflicts between modules. */
function portConflicts(packs) {
	const issues = [];
	const seen = /* @__PURE__ */ new Map();
	for (const pack of packs) for (const module of pack.modules) {
		const port = MODULE_PORTS[module.id];
		if (port === void 0) continue;
		const owner = seen.get(port);
		if (owner === void 0) seen.set(port, module.id);
		else issues.push(`Port ${port} conflict: ${module.id} and ${owner} both use it.`);
	}
	return issues;
}
/**
* Generate a full doctor report.
* @param packs - loaded packs, each with its modules.
* @param discovery - discovery results keyed by module id order.
* @param statuses - current supervisor module statuses.
* @param approvalService - whether an approval service is present in this dsh process.
* @param environment - additional environment-wide issue strings.
* @param backup - per-module backup readiness, in module order.
* @returns the doctor report.
*/
function generateDoctor(packs, discovery, statuses, approvalService, environment = [], backup = []) {
	const modules = buildModules(packs, discovery, statuses);
	const env = [...environment, ...portConflicts(packs)];
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		approvalService,
		packs: packs.map((p) => ({
			packageName: p.packageName,
			moduleCount: p.modules.length
		})),
		modules,
		backup,
		environment: env
	};
}
// src/config.ts
/**
* Validation for the hub's `cordis.patch.yml` row. Every value is checked
* before the registry touches the filesystem, so a malformed row fails at load
* with a message naming the exact field instead of a downstream `undefined`.
* @module @pinnacle/mcp-hub/src/config
*/
/** Raised when the configuration row is malformed. */
var HubConfigError = class extends Error {
	/** @param message - an actionable description naming the offending field. */
	constructor(message) {
		super(message);
		this.name = "HubConfigError";
	}
};
const WRITE_MODES = [
	"deny",
	"confirm",
	"allow"
];
const APPLY_MODES = ["confirm", "auto"];
const BACKUP_FAILURE_MODES = ["block", "warn"];
/** Defaults applied when a row omits an optional section. */
const DEFAULT_DEFAULTS = {
	profile: "coordination",
	writeMode: "deny",
	maxVisibleTools: 120,
	pollMs: 2e4
};
/** Defaults applied when the row omits its `backup` section. */
const DEFAULT_BACKUP = {
	failure: "block",
	dedupeMs: 12e4,
	keep: 10,
	minFreeMb: 2048,
	timeoutMs: 2e4,
	files: {}
};
/** Read a record-like value, or fail with the field's path. */
function record$1(value, path) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be a mapping`);
	return value;
}
/** Read a non-empty string. */
function text$1(value, path) {
	if (typeof value !== "string" || value.length === 0) throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be a non-empty string`);
	return value;
}
/** Read a non-empty string list, rejecting non-strings instead of coercing them. */
function packageNames(value, path) {
	if (!Array.isArray(value)) throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be a list of package names`);
	return value.map((entry, index) => text$1(entry, `${path}[${index}]`));
}
/** Read one enum member, listing the accepted values in the error. */
function oneOf$1(value, allowed, path) {
	if (typeof value === "string" && allowed.includes(value)) return value;
	throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be one of ${allowed.join(" | ")}, got ${JSON.stringify(value)}`);
}
/** Read a positive integer bound. */
function positiveInteger(value, path) {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be a positive integer, got ${JSON.stringify(value)}`);
	return value;
}
/** Read a non-negative integer bound (zero disables the feature). */
function nonNegativeInteger(value, path) {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be a non-negative integer, got ${JSON.stringify(value)}`);
	return value;
}
/** Read an absolute path; relative paths would depend on the process CWD. */
function absolutePath(value, path) {
	const resolved = text$1(value, path);
	if (!isAbsolute(resolved)) throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be an absolute path, got ${JSON.stringify(resolved)}`);
	return resolved;
}
/** Validate the `discovery` section, defaulting to confirmation. */
function readDiscovery$1(raw) {
	if (raw === void 0) return { applyMode: "confirm" };
	const source = record$1(raw, "config.discovery");
	return { applyMode: source.applyMode === void 0 ? "confirm" : oneOf$1(source.applyMode, APPLY_MODES, "config.discovery.applyMode") };
}
/** Validate the `defaults` section, filling each absent field from {@link DEFAULT_DEFAULTS}. */
function readDefaults(raw) {
	if (raw === void 0) return DEFAULT_DEFAULTS;
	const source = record$1(raw, "config.defaults");
	return {
		profile: source.profile === void 0 ? DEFAULT_DEFAULTS.profile : text$1(source.profile, "config.defaults.profile"),
		writeMode: source.writeMode === void 0 ? DEFAULT_DEFAULTS.writeMode : oneOf$1(source.writeMode, WRITE_MODES, "config.defaults.writeMode"),
		maxVisibleTools: source.maxVisibleTools === void 0 ? DEFAULT_DEFAULTS.maxVisibleTools : positiveInteger(source.maxVisibleTools, "config.defaults.maxVisibleTools"),
		pollMs: source.pollMs === void 0 ? DEFAULT_DEFAULTS.pollMs : positiveInteger(source.pollMs, "config.defaults.pollMs")
	};
}
/** Validate the `backup` section, filling each absent field from {@link DEFAULT_BACKUP}. */
function readBackup(raw) {
	if (raw === void 0) return DEFAULT_BACKUP;
	const source = record$1(raw, "config.backup");
	const files = {};
	if (source.files !== void 0) {
		const entries = record$1(source.files, "config.backup.files");
		for (const [id, value] of Object.entries(entries)) files[id] = absolutePath(value, `config.backup.files.${id}`);
	}
	return {
		failure: source.failure === void 0 ? DEFAULT_BACKUP.failure : oneOf$1(source.failure, BACKUP_FAILURE_MODES, "config.backup.failure"),
		dedupeMs: source.dedupeMs === void 0 ? DEFAULT_BACKUP.dedupeMs : nonNegativeInteger(source.dedupeMs, "config.backup.dedupeMs"),
		keep: source.keep === void 0 ? DEFAULT_BACKUP.keep : positiveInteger(source.keep, "config.backup.keep"),
		minFreeMb: source.minFreeMb === void 0 ? DEFAULT_BACKUP.minFreeMb : nonNegativeInteger(source.minFreeMb, "config.backup.minFreeMb"),
		timeoutMs: source.timeoutMs === void 0 ? DEFAULT_BACKUP.timeoutMs : positiveInteger(source.timeoutMs, "config.backup.timeoutMs"),
		files
	};
}
/**
* Validate the row's `config` value.
* @param raw - the unvalidated `config` mapping handed to `apply`.
* @returns the complete hub configuration, with defaults filled per section.
* @throws {HubConfigError} when any field is absent or has the wrong type.
*/
function readHubConfig(raw) {
	const source = raw === void 0 ? {} : record$1(raw, "config");
	return {
		packs: source.packs === void 0 ? [] : packageNames(source.packs, "config.packs"),
		discovery: readDiscovery$1(source.discovery),
		defaults: readDefaults(source.defaults),
		backup: readBackup(source.backup)
	};
}
// src/modules.ts
/**
* Build supervisor specs in pack declaration order.
* @param packs - validated packs from the registry.
* @returns one spec per module that declares an MCP server entry.
*/
function moduleSpecs(packs) {
	const specs = [];
	for (const pack of packs) for (const module of pack.manifest.modules) {
		if (module.server === void 0) continue;
		specs.push({
			id: module.id,
			title: module.title,
			enabled: true,
			requiresApp: module.requiresApp,
			processNames: module.app?.processNames ?? [],
			entry: module.server,
			...module.discovery === void 0 ? {} : { discovery: module.discovery }
		});
	}
	return specs;
}
// src/registry.ts
/**
* Pack registry: resolves the pack package names listed in the hub row and
* validates each pack's exported manifest before any module reaches the MCP
* manager. A pack is a plain ESM package exporting `pack`; the hub never reads
* pack internals, so a broken pack is reported by name instead of crashing the
* profile.
* @module @pinnacle/mcp-hub/src/registry
*/
/** Raised when a pack cannot be resolved or its manifest is invalid. */
var PackRegistryError = class extends Error {
	/** @param message - an actionable description naming the pack and field. */
	constructor(message) {
		super(message);
		this.name = "PackRegistryError";
	}
};
/** Read a record-like value, or fail with the pack and field path. */
function record(value, path) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PackRegistryError(`pinnacle-mcp-hub: ${path} must be a mapping`);
	return value;
}
/** Read a non-empty string field. */
function text(value, path) {
	if (typeof value !== "string" || value.length === 0) throw new PackRegistryError(`pinnacle-mcp-hub: ${path} must be a non-empty string`);
	return value;
}
/** Read a boolean field without coercing truthy values. */
function flag(value, path) {
	if (typeof value !== "boolean") throw new PackRegistryError(`pinnacle-mcp-hub: ${path} must be a boolean`);
	return value;
}
/** Read one enum member, listing the accepted values in the error. */
function oneOf(value, allowed, path) {
	if (typeof value === "string" && allowed.includes(value)) return value;
	throw new PackRegistryError(`pinnacle-mcp-hub: ${path} must be one of ${allowed.join(" | ")}, got ${JSON.stringify(value)}`);
}
/** Read a list of non-empty strings. */
function textList(value, path) {
	if (!Array.isArray(value)) throw new PackRegistryError(`pinnacle-mcp-hub: ${path} must be a list of strings`);
	return value.map((entry, index) => text(entry, `${path}[${index}]`));
}
/** Read a mapping of string keys to string values. */
function textMap(value, path) {
	const source = record(value, path);
	const result = {};
	for (const [key, entry] of Object.entries(source)) result[key] = text(entry, `${path}.${key}`);
	return result;
}
/** Read a positive integer. */
function integer(value, path) {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new PackRegistryError(`pinnacle-mcp-hub: ${path} must be a positive integer, got ${JSON.stringify(value)}`);
	return value;
}
/** Read the optional reconnect policy. */
function readReconnect(value, path) {
	const source = record(value, path);
	return {
		...source.enabled === void 0 ? {} : { enabled: flag(source.enabled, `${path}.enabled`) },
		...source.initialDelayMs === void 0 ? {} : { initialDelayMs: integer(source.initialDelayMs, `${path}.initialDelayMs`) },
		...source.maxDelayMs === void 0 ? {} : { maxDelayMs: integer(source.maxDelayMs, `${path}.maxDelayMs`) },
		...source.maxAttempts === void 0 ? {} : { maxAttempts: integer(source.maxAttempts, `${path}.maxAttempts`) }
	};
}
/** Validate the optional MCP server entry a pack contributes. */
function readServer(value, path) {
	const source = record(value, path);
	const transport = oneOf(source.transport, ["stdio", "streamable-http"], `${path}.transport`);
	const entry = {
		transport,
		...source.command === void 0 ? {} : { command: text(source.command, `${path}.command`) },
		...source.args === void 0 ? {} : { args: textList(source.args, `${path}.args`) },
		...source.env === void 0 ? {} : { env: textMap(source.env, `${path}.env`) },
		...source.cwd === void 0 ? {} : { cwd: text(source.cwd, `${path}.cwd`) },
		...source.url === void 0 ? {} : { url: text(source.url, `${path}.url`) },
		...source.headers === void 0 ? {} : { headers: textMap(source.headers, `${path}.headers`) },
		...source.toolCallTimeoutMs === void 0 ? {} : { toolCallTimeoutMs: integer(source.toolCallTimeoutMs, `${path}.toolCallTimeoutMs`) },
		...source.startupTimeoutMs === void 0 ? {} : { startupTimeoutMs: integer(source.startupTimeoutMs, `${path}.startupTimeoutMs`) },
		...source.closeTimeoutMs === void 0 ? {} : { closeTimeoutMs: integer(source.closeTimeoutMs, `${path}.closeTimeoutMs`) },
		...source.reconnect === void 0 ? {} : { reconnect: readReconnect(source.reconnect, `${path}.reconnect`) }
	};
	if (transport === "stdio" && entry.command === void 0) throw new PackRegistryError(`pinnacle-mcp-hub: ${path}.command is required for a stdio server`);
	if (transport === "streamable-http" && entry.url === void 0) throw new PackRegistryError(`pinnacle-mcp-hub: ${path}.url is required for a streamable-http server`);
	return entry;
}
/** Validate the optional app-gate declaration. */
function readApp(value, path) {
	const source = record(value, path);
	return { processNames: source.processNames === void 0 ? [] : textList(source.processNames, `${path}.processNames`) };
}
/** Validate the optional discovery hints. */
function readDiscovery(value, path) {
	const source = record(value, path);
	return {
		...source.serverPaths === void 0 ? {} : { serverPaths: textList(source.serverPaths, `${path}.serverPaths`) },
		...source.appPaths === void 0 ? {} : { appPaths: textList(source.appPaths, `${path}.appPaths`) },
		...source.unsupported === void 0 ? {} : { unsupported: flag(source.unsupported, `${path}.unsupported`) }
	};
}
/** Validate one module declaration. */
function readModule(value, path) {
	const source = record(value, path);
	const backup = record(source.backup, `${path}.backup`);
	return {
		id: text(source.id, `${path}.id`),
		title: text(source.title, `${path}.title`),
		toolPrefix: text(source.toolPrefix, `${path}.toolPrefix`),
		requiresApp: flag(source.requiresApp, `${path}.requiresApp`),
		backup: {
			supported: flag(backup.supported, `${path}.backup.supported`),
			...backup.tool === void 0 ? {} : { tool: text(backup.tool, `${path}.backup.tool`) },
			...backup.pathArg === void 0 ? {} : { pathArg: text(backup.pathArg, `${path}.backup.pathArg`) },
			...backup.docPathTool === void 0 ? {} : { docPathTool: text(backup.docPathTool, `${path}.backup.docPathTool`) }
		},
		...source.writes === void 0 ? {} : { writes: textList(source.writes, `${path}.writes`) },
		...source.reads === void 0 ? {} : { reads: textList(source.reads, `${path}.reads`) },
		...source.server === void 0 ? {} : { server: readServer(source.server, `${path}.server`) },
		...source.app === void 0 ? {} : { app: readApp(source.app, `${path}.app`) },
		...source.discovery === void 0 ? {} : { discovery: readDiscovery(source.discovery, `${path}.discovery`) }
	};
}
/**
* Reject module ids or tool prefixes declared twice inside one pack: a tool
* name must map to exactly one module for policy and audit attribution.
* @param modules - the pack's modules, validated individually.
* @param packageName - the pack name used in the failure message.
* @throws {PackRegistryError} when an id or prefix repeats.
*/
function assertUniqueModules(modules, packageName) {
	const ids = /* @__PURE__ */ new Set();
	const prefixes = /* @__PURE__ */ new Set();
	for (const module of modules) {
		if (ids.has(module.id)) throw new PackRegistryError(`pinnacle-mcp-hub: ${packageName} declares module id ${JSON.stringify(module.id)} twice`);
		if (prefixes.has(module.toolPrefix)) throw new PackRegistryError(`pinnacle-mcp-hub: ${packageName} declares tool prefix ${JSON.stringify(module.toolPrefix)} twice; tool names must map to exactly one module`);
		ids.add(module.id);
		prefixes.add(module.toolPrefix);
	}
}
/** Validate the `pack` export of one package. */
function readManifest(value, packageName) {
	const source = record(value, `${packageName} pack`);
	if (!Array.isArray(source.modules)) throw new PackRegistryError(`pinnacle-mcp-hub: ${packageName} pack.modules must be a list`);
	const modules = source.modules.map((entry, index) => readModule(entry, `${packageName} pack.modules[${index}]`));
	assertUniqueModules(modules, packageName);
	return {
		name: text(source.name, `${packageName} pack.name`),
		version: text(source.version, `${packageName} pack.version`),
		modules
	};
}
/** Import one pack package and validate its manifest. */
async function loadPack(packageName) {
	let exported;
	try {
		exported = await import(packageName);
	} catch (error) {
		throw new PackRegistryError(`pinnacle-mcp-hub: cannot load pack ${JSON.stringify(packageName)}: ${errorMessage(error)}. Install it into this profile with 'dsh plugin add ${packageName}' or remove it from config.packs.`);
	}
	const namespace = record(exported, `${packageName} exports`);
	if (namespace.pack === void 0) throw new PackRegistryError(`pinnacle-mcp-hub: ${packageName} does not export 'pack'; a pack package must export its manifest as 'pack'`);
	return {
		packageName,
		manifest: readManifest(namespace.pack, packageName)
	};
}
/** Reject a package listed twice before any import runs. */
function assertUniqueNames(packageNames) {
	const seen = /* @__PURE__ */ new Set();
	for (const name of packageNames) {
		if (seen.has(name)) throw new PackRegistryError(`pinnacle-mcp-hub: pack ${JSON.stringify(name)} is listed twice in config.packs`);
		seen.add(name);
	}
}
/** Reject one module id declared by two packs. */
function assertUniqueModuleOwners(packs) {
	const owners = /* @__PURE__ */ new Map();
	for (const pack of packs) for (const module of pack.manifest.modules) {
		const owner = owners.get(module.id);
		if (owner !== void 0) throw new PackRegistryError(`pinnacle-mcp-hub: module id ${JSON.stringify(module.id)} is declared by both ${owner} and ${pack.packageName}`);
		owners.set(module.id, pack.packageName);
	}
}
/**
* Resolve every configured pack in declaration order.
* @param packageNames - pack package names from `config.packs`.
* @returns the validated packs, in the configured order.
* @throws {PackRegistryError} for duplicate names, unresolvable packages, or invalid manifests.
*/
async function loadPacks(packageNames) {
	assertUniqueNames(packageNames);
	const loaded = [];
	for (const name of packageNames) loaded.push(await loadPack(name));
	assertUniqueModuleOwners(loaded);
	return loaded;
}
// src/policy.ts
/** Actions that never require policy approval (read-only). */
const SAFE_ACTIONS = /* @__PURE__ */ new Set([
	"status",
	"list",
	"doctor",
	"discover",
	"audit",
	"backups"
]);
/** Actions that change module state and are governed by writeMode. */
const WRITE_ACTIONS = /* @__PURE__ */ new Set([
	"enable",
	"disable",
	"probe"
]);
/** Read the action and module from parsed aec_control arguments. */
function readAecArgs(args) {
	if (args === null || typeof args !== "object") return {
		action: void 0,
		module: void 0
	};
	const record = args;
	return {
		action: typeof record.action === "string" ? record.action : void 0,
		module: typeof record.module === "string" ? record.module : void 0
	};
}
/** Policy decision for a write action based on writeMode. */
function decide(writeMode, hasApproval) {
	switch (writeMode) {
		case "deny": return {
			kind: "deny",
			reason: "Write operations are denied by hub policy (writeMode: deny)."
		};
		case "confirm":
			if (hasApproval) return {
				kind: "ask",
				reason: "Write operation requires confirmation (writeMode: confirm).",
				displayReason: { en: "Confirm AEC hub write operation" }
			};
			return {
				kind: "deny",
				reason: "Write operations require confirmation but no approval service is available."
			};
		case "allow": return { kind: "allow" };
		default: return {
			kind: "deny",
			reason: `Unknown writeMode: ${writeMode}`
		};
	}
}
/**
* Build the `tools/pre-execute` listener for the hub's write policy.
* @param hubStatus - a thunk returning the current hub status (config + modules).
* @param hasApproval - whether an approval service is present.
* @returns a listener `(exec, next) => Promise<PreToolDecision>`.
*/
function writePolicyListener(hubStatus, hasApproval) {
	return async (exec, next) => {
		if (exec.name !== "aec_control") return next();
		const { action } = readAecArgs(exec.arguments);
		if (action === void 0 || SAFE_ACTIONS.has(action)) return next();
		if (WRITE_ACTIONS.has(action)) {
			const decision = decide(hubStatus()?.config.defaults.writeMode ?? "deny", hasApproval);
			if (decision.kind !== "allow") return decision;
			return next();
		}
		return next();
	};
}
/**
* Build the `tools/pre-execute` listener that applies `writeMode` to a module's
* own MCP tools, not only to `aec_control`. Without it the model could bypass
* the write policy by calling `mcp__<module>__<tool>` directly.
* @param identify - maps a tool name to its module and classification.
* @param hubStatus - a thunk returning the current hub status.
* @param hasApproval - whether an approval service is present.
* @returns a listener `(exec, next) => Promise<PreToolDecision>`.
*/
function moduleWriteListener(identify, hubStatus, hasApproval) {
	return async (exec, next) => {
		if (exec.name === "aec_control") return next();
		const found = identify(exec.name);
		if (found === void 0 || found.kind === "read") return next();
		const decision = decide(hubStatus()?.config.defaults.writeMode ?? "deny", hasApproval);
		if (decision.kind !== "allow") return decision;
		return next();
	};
}
// src/supervisor.ts
/**
* Module supervisor: owns the MCP registrations the hub adds for a profile,
* gates them on whether their host application is running, and reports one of
* the settled states `disabled`, `app_not_running`, `connected`, or `error`.
* `starting` is the transient between registration and the first connection
* result.
*
* Every registration is released through its disposer when the module is
* disabled, its application disappears, or the supervisor stops, so a
* long-running dsh process never accumulates orphaned MCP children.
* @module @pinnacle/mcp-hub/src/supervisor
*/
/** Raised when a command or the page names a module the supervisor does not track. */
var SupervisorError = class extends Error {
	/** @param message - an actionable description naming the unknown module. */
	constructor(message) {
		super(message);
		this.name = "SupervisorError";
	}
};
/** Default probe budget when neither the command nor the entry supplies one. */
const DEFAULT_PROBE_TIMEOUT_MS = 3e4;
/** Remove a directory component and `.exe` so `C:\â€¦\acad.exe` matches `acad`. */
function normalizeProcessName(name) {
	return (name.replace(/\\/g, "/").split("/").pop() ?? name).toLowerCase().replace(/\.exe$/, "");
}
/** Whether any declared process name appears in the scan result. */
function matchesApp(processNames, running) {
	if (processNames.length === 0) return false;
	const scanned = /* @__PURE__ */ new Set();
	for (const name of running) scanned.add(normalizeProcessName(name));
	return processNames.some((name) => scanned.has(normalizeProcessName(name)));
}
/** Release a Node timer without keeping the process alive for a poll that may never fire. */
function unref(handle) {
	if (typeof handle !== "object" || handle === null || !("unref" in handle)) return;
	const candidate = handle;
	if (typeof candidate.unref === "function") candidate.unref();
}
const DEFAULT_TIMERS = {
	setInterval: (callback, ms) => {
		const handle = setInterval(callback, ms);
		unref(handle);
		return handle;
	},
	clearInterval: (handle) => {
		clearInterval(handle);
	},
	setTimeout: (callback, ms) => {
		const handle = setTimeout(callback, ms);
		unref(handle);
		return handle;
	},
	clearTimeout: (handle) => {
		clearTimeout(handle);
	}
};
/** Build the human-readable failure detail for a terminal manager status. */
function failureDetail(status) {
	switch (status.state) {
		case "failed":
			if ("result" in status) return `Cleanup failed after the server stopped${status.result.cleanupError === void 0 ? "" : `: ${status.result.cleanupError}`}`;
			return `The MCP client stopped retrying (${status.reason})${status.lastError === void 0 ? "" : `: ${status.lastError}`}`;
		case "waiting-credentials": return `Waiting for credentials: ${status.lastError}`;
		case "closed": return `The MCP connection closed${status.result.cleanupError === void 0 ? "" : `: ${status.result.cleanupError}`}`;
		case "disabled": return "mcp-manager reports the server disabled although the hub registered it.";
		default: return "The MCP client reported an unexpected failure.";
	}
}
/** Convert one manager status into a probe outcome when it is terminal. */
function probeOutcome(status, startedAt, now) {
	const durationMs = Math.max(0, now() - startedAt);
	switch (status.state) {
		case "connected": return {
			ok: true,
			stage: "connect",
			durationMs,
			toolCount: status.toolCount
		};
		case "failed": return {
			ok: false,
			stage: "connect",
			durationMs,
			message: failureDetail(status)
		};
		case "waiting-credentials": return {
			ok: false,
			stage: "connect",
			durationMs,
			message: failureDetail(status)
		};
		case "closed": return {
			ok: false,
			stage: "connect",
			durationMs,
			message: failureDetail(status)
		};
		case "disabled": return {
			ok: false,
			stage: "connect",
			durationMs,
			message: failureDetail(status)
		};
		default: return;
	}
}
/**
* One supervisor instance per hub. The class is deliberately independent of
* Cordis so state transitions, polling, and probe cleanup are unit-testable
* with fake manager, process, and timer ports.
*/
var Supervisor = class {
	runtimes;
	byId;
	appGate;
	pollMs;
	probeTimeoutMs;
	now;
	timers;
	onTransition;
	/** Probe waiters keyed by module id; each resolves on a terminal status. */
	probeWaiters = /* @__PURE__ */ new Map();
	manager;
	started = false;
	stopped = false;
	interval;
	queue = Promise.resolve();
	/** @param options - modules plus the ports the host wires to real services. */
	constructor(options) {
		if (!Number.isInteger(options.pollMs) || options.pollMs <= 0) throw new SupervisorError(`pinnacle-mcp-hub: pollMs must be a positive integer, got ${String(options.pollMs)}`);
		const now = options.now ?? Date.now;
		this.appGate = options.appGate;
		this.pollMs = options.pollMs;
		this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
		this.now = now;
		this.timers = options.timers ?? DEFAULT_TIMERS;
		this.onTransition = options.onTransition;
		this.manager = options.manager;
		this.runtimes = options.modules.map((spec) => ({
			spec,
			enabled: spec.enabled,
			state: "disabled",
			detail: "The supervisor has not started.",
			since: new Date(now()).toISOString(),
			appGate: spec.requiresApp && spec.processNames.length > 0,
			appRunning: false,
			registered: false,
			dispose: void 0,
			probing: false,
			toolCount: void 0
		}));
		this.byId = new Map(this.runtimes.map((runtime) => [runtime.spec.id, runtime]));
	}
	/** Replace the manager port, typically when the service finishes loading. */
	attachManager(manager) {
		if (this.stopped) return;
		this.manager = manager;
		this.refresh();
	}
	/** Attach the process gate, typically when discovery supplies process names. */
	attachAppGate(appGate) {
		if (this.stopped) return;
		this.appGate = appGate;
		this.refresh();
	}
	/** Start supervision: one initial scan, then polling while a gate is enabled. */
	async start() {
		if (this.stopped) throw new SupervisorError("pinnacle-mcp-hub: the supervisor is disposed");
		if (this.started) return;
		this.started = true;
		await this.refresh();
	}
	/**
	* Re-scan the app gate and reconcile registrations.
	* @returns a promise settling after this pass, serialized behind earlier passes.
	*/
	refresh() {
		this.queue = this.queue.then(async () => {
			if (!this.started || this.stopped) return;
			await this.reconcile();
			this.updateTimer();
		}, () => void 0);
		return this.queue;
	}
	/**
	* Apply one manager status. Probe registrations consume the status before it
	* can change the module's supervised state.
	* @param name - the module id the status belongs to.
	* @param status - the manager's current status.
	*/
	handleStatus(name, status) {
		if (this.stopped) return;
		const runtime = this.byId.get(name);
		if (runtime === void 0) return;
		if (runtime.registered) this.applyStatus(runtime, status);
		const waiter = this.probeWaiters.get(name);
		if (waiter !== void 0) waiter(status);
	}
	/**
	* Enable or disable one module and reconcile immediately.
	* @param id - the module id.
	* @param enabled - whether the hub should keep it mounted.
	* @returns the module's state after reconciliation.
	*/
	async setEnabled(id, enabled) {
		const runtime = this.require(id);
		if (runtime.enabled !== enabled) {
			runtime.enabled = enabled;
			if (!enabled) {
				const failure = this.unregister(runtime);
				this.transition(runtime, failure === void 0 ? "disabled" : "error", failure ?? "Disabled in the hub configuration.");
			}
		}
		await this.refresh();
		return this.statusOf(runtime);
	}
	/**
	* Probe one module. A live registration is tested through the manager's
	* non-disruptive probe; a dormant module is registered temporarily and
	* released after the outcome.
	* @param id - the module id.
	* @param options - override the probe budget or abort it.
	* @returns the probe outcome; never throws for a failed probe.
	*/
	async probe(id, options = {}) {
		const runtime = this.require(id);
		if (this.probeWaiters.has(id)) return {
			ok: false,
			stage: "register",
			durationMs: 0,
			message: "a probe for this module is already running"
		};
		if (this.manager === void 0) return {
			ok: false,
			stage: "register",
			durationMs: 0,
			message: "mcp-manager is not loaded in this dsh process"
		};
		const timeoutMs = options.timeoutMs ?? runtime.spec.entry.startupTimeoutMs ?? this.probeTimeoutMs;
		if (runtime.registered) return this.probeRegistered(runtime, timeoutMs, options.signal);
		return this.probeTemporary(runtime, timeoutMs, options.signal);
	}
	/** Release every registration and stop polling. Idempotent. */
	stop() {
		if (this.stopped) return;
		this.stopped = true;
		if (this.interval !== void 0) {
			this.timers.clearInterval(this.interval);
			this.interval = void 0;
		}
		for (const runtime of this.runtimes) {
			this.unregister(runtime);
			runtime.state = "disabled";
			runtime.detail = "The hub stopped.";
			runtime.since = new Date(this.now()).toISOString();
		}
		this.probeWaiters.clear();
	}
	/** @returns a detached snapshot in pack declaration order. */
	snapshot() {
		return this.runtimes.map((runtime) => this.statusOf(runtime));
	}
	/** Test and diagnostics hook: whether a poll timer is currently armed. */
	polling() {
		return this.interval !== void 0;
	}
	/** One gate-on pass: one process query for every enabled gated module. */
	async reconcile() {
		const requested = /* @__PURE__ */ new Set();
		for (const runtime of this.runtimes) {
			if (!this.gateOn(runtime)) continue;
			for (const name of runtime.spec.processNames) requested.add(name);
		}
		let running = /* @__PURE__ */ new Set();
		let scanError;
		if (requested.size > 0) {
			if (this.appGate === void 0) scanError = "process detection is unavailable";
			else try {
				running = new Set(await this.appGate.running([...requested]));
			} catch (error) {
				scanError = `the process scan failed: ${errorMessage(error)}`;
			}
		}
		for (const runtime of this.runtimes) {
			runtime.appGate = this.gateOn(runtime);
			runtime.appRunning = runtime.appGate && scanError === void 0 ? matchesApp(runtime.spec.processNames, running) : false;
			if (!runtime.enabled) {
				const failure = this.unregister(runtime);
				this.transition(runtime, failure === void 0 ? "disabled" : "error", failure ?? "Disabled in the hub configuration.");
				continue;
			}
			if (this.manager === void 0) {
				const failure = this.unregister(runtime);
				this.transition(runtime, "error", failure ?? "mcp-manager is not loaded in this dsh process.");
				continue;
			}
			if (runtime.probing) continue;
			if (runtime.appGate && (scanError !== void 0 || !runtime.appRunning)) {
				const failure = this.unregister(runtime);
				if (failure !== void 0) {
					this.transition(runtime, "error", failure);
					continue;
				}
				this.transition(runtime, "app_not_running", scanError ?? `Waiting for ${runtime.spec.processNames.join(" or ")}.`);
				continue;
			}
			if (!runtime.registered) this.register(runtime);
		}
	}
	/** Whether a module has a populated process gate. */
	gateOn(runtime) {
		return runtime.spec.requiresApp && runtime.spec.processNames.length > 0;
	}
	/** Mount one module and move it to the transient `starting` state. */
	register(runtime) {
		if (this.manager === void 0) return;
		try {
			runtime.dispose = this.manager.register(runtime.spec.id, runtime.spec.entry);
			runtime.registered = true;
			this.transition(runtime, "starting", "Registered; waiting for the MCP server to connect.");
		} catch (error) {
			runtime.registered = false;
			runtime.dispose = void 0;
			this.transition(runtime, "error", `Cannot register the MCP server: ${errorMessage(error)}`);
		}
	}
	/** Release one registration; returns a failure message when disposal throws. */
	unregister(runtime) {
		if (!runtime.registered) return void 0;
		const dispose = runtime.dispose;
		runtime.registered = false;
		runtime.dispose = void 0;
		runtime.toolCount = void 0;
		try {
			dispose?.();
			return;
		} catch (error) {
			return `Disposing the MCP server failed: ${errorMessage(error)}`;
		}
	}
	/** Map one manager status onto a settled or transient module state. */
	applyStatus(runtime, status) {
		switch (status.state) {
			case "connected":
				runtime.toolCount = status.toolCount;
				this.transition(runtime, "connected", `${status.toolCount} tool${status.toolCount === 1 ? "" : "s"} available.`);
				return;
			case "connecting":
				runtime.toolCount = void 0;
				this.transition(runtime, "starting", status.attempt === 0 ? "Connecting to the MCP server." : `Connecting to the MCP server (attempt ${status.attempt + 1}).`);
				return;
			case "reconnecting":
				runtime.toolCount = void 0;
				this.transition(runtime, "starting", `Reconnecting in ${Math.max(0, status.nextRetryAtMs - this.now())} ms (attempt ${status.attempt}/${status.maxAttempts}): ${status.lastError}`);
				return;
			case "waiting-credentials":
			case "failed":
			case "closed":
			case "disabled":
				runtime.toolCount = void 0;
				this.transition(runtime, "error", failureDetail(status));
				return;
			default: this.transition(runtime, "error", "mcp-manager reported an unrecognized status.");
		}
	}
	/** Probe a module that is already mounted; the manager probe leaves it untouched. */
	async probeRegistered(runtime, timeoutMs, signal) {
		const manager = this.manager;
		if (manager?.probe !== void 0) try {
			const result = await manager.probe(runtime.spec.id, signal === void 0 ? void 0 : { signal });
			return {
				ok: result.ok,
				stage: result.ok ? "connect" : result.stage,
				durationMs: result.durationMs,
				...result.ok ? { toolCount: result.toolNames.length } : { message: result.message },
				...result.cleanupError === void 0 ? {} : { cleanupError: result.cleanupError }
			};
		} catch (error) {
			return {
				ok: false,
				stage: "connect",
				durationMs: 0,
				message: `The manager could not probe the live server: ${errorMessage(error)}`
			};
		}
		if (runtime.toolCount !== void 0) return {
			ok: true,
			stage: "connect",
			durationMs: 0,
			toolCount: runtime.toolCount
		};
		const startedAt = this.now();
		return this.beginWait(runtime.spec.id, startedAt, timeoutMs, signal).promise;
	}
	/** Register a dormant module, probe it, then release it. Leaves no registration behind. */
	async probeTemporary(runtime, timeoutMs, signal) {
		if (this.manager === void 0) return {
			ok: false,
			stage: "register",
			durationMs: 0,
			message: "mcp-manager is not loaded in this dsh process"
		};
		const startedAt = this.now();
		const wait = this.beginWait(runtime.spec.id, startedAt, timeoutMs, signal);
		let dispose;
		runtime.probing = true;
		runtime.registered = true;
		try {
			dispose = this.manager.register(runtime.spec.id, runtime.spec.entry);
			if (this.manager.probe !== void 0) {
				const result = await this.manager.probe(runtime.spec.id, signal === void 0 ? void 0 : { signal });
				return {
					ok: result.ok,
					stage: result.ok ? "connect" : result.stage,
					durationMs: result.durationMs,
					...result.ok ? { toolCount: result.toolNames.length } : { message: result.message },
					...result.cleanupError === void 0 ? {} : { cleanupError: result.cleanupError }
				};
			}
			return wait.promise;
		} catch (error) {
			wait.settle({
				ok: false,
				stage: "register",
				durationMs: Math.max(0, this.now() - startedAt),
				message: errorMessage(error)
			});
			return wait.promise;
		} finally {
			runtime.probing = false;
			runtime.registered = false;
			runtime.dispose = void 0;
			try {
				dispose?.();
			} catch (error) {
				runtime.detail = `Probe cleanup failed: ${errorMessage(error)}`;
			}
			if (!runtime.enabled) this.transition(runtime, "disabled", "Disabled in the hub configuration.");
			this.refresh();
		}
	}
	/** Arm one status waiter plus its timeout and abort path. */
	beginWait(id, startedAt, timeoutMs, signal) {
		let settle = () => void 0;
		const promise = new Promise((resolve) => {
			settle = resolve;
		});
		let settled = false;
		const finish = (outcome) => {
			if (settled) return;
			settled = true;
			this.timers.clearTimeout(handle);
			signal?.removeEventListener("abort", onAbort);
			if (this.probeWaiters.get(id) === onStatus) this.probeWaiters.delete(id);
			settle(outcome);
		};
		const onStatus = (status) => {
			const outcome = probeOutcome(status, startedAt, this.now);
			if (outcome !== void 0) finish(outcome);
		};
		const onAbort = () => {
			finish({
				ok: false,
				stage: "timeout",
				durationMs: Math.max(0, this.now() - startedAt),
				message: "the probe was aborted"
			});
		};
		const handle = this.timers.setTimeout(() => {
			finish({
				ok: false,
				stage: "timeout",
				durationMs: Math.max(0, this.now() - startedAt),
				message: `the probe timed out after ${timeoutMs} ms`
			});
		}, timeoutMs);
		this.probeWaiters.set(id, onStatus);
		signal?.addEventListener("abort", onAbort, { once: true });
		return {
			promise,
			settle: finish
		};
	}
	/** Arm or disarm the poll timer from the current set of enabled gated modules. */
	updateTimer() {
		const needed = this.started && !this.stopped && this.runtimes.some((runtime) => runtime.enabled && this.gateOn(runtime));
		if (needed && this.interval === void 0) this.interval = this.timers.setInterval(() => {
			this.refresh();
		}, this.pollMs);
		else if (!needed && this.interval !== void 0) {
			this.timers.clearInterval(this.interval);
			this.interval = void 0;
		}
	}
	/** Publish a state change once and notify the evidence listener. */
	transition(runtime, state, detail) {
		if (runtime.state === state && runtime.detail === detail) return;
		runtime.state = state;
		runtime.detail = detail;
		runtime.since = new Date(this.now()).toISOString();
		const status = this.statusOf(runtime);
		try {
			this.onTransition?.(status);
		} catch {}
	}
	/** Detached view of one runtime. */
	statusOf(runtime) {
		return {
			id: runtime.spec.id,
			title: runtime.spec.title,
			state: runtime.state,
			detail: runtime.detail,
			appGate: runtime.appGate,
			appRunning: runtime.appRunning,
			since: runtime.since
		};
	}
	/** Resolve a module id or fail with the known ids. */
	require(id) {
		const runtime = this.byId.get(id);
		if (runtime !== void 0) return runtime;
		const known = this.runtimes.map((entry) => entry.spec.id).join(", ");
		throw new SupervisorError(`pinnacle-mcp-hub: unknown module ${JSON.stringify(id)}; known modules: ${known.length === 0 ? "(none)" : known}`);
	}
};
// src/control.ts
/**
* The `aec_control` tool â€” the only model-facing surface of the PINNACLE MCP hub.
*
* Actions:
* - `status` â€” hub status summary (safe)
* - `list` â€” module table with states (safe)
* - `enable <module>` â€” enable a module (write, governed by writeMode)
* - `disable <module>` â€” disable a module (write, governed by writeMode)
* - `probe <module>` â€” clean probe of a module (write, governed by writeMode)
* - `doctor` â€” full diagnosis (safe)
* - `discover` â€” discovery results with confidence (safe)
*
* `writeMode` is never exposed to the model; write actions are governed by the
* hub's default writeMode through `tools/pre-execute`. `status`/`list`/`doctor`/`discover`
* are always allowed.
* @module @pinnacle/mcp-hub/src/control
*/
/** The single model-facing tool name. */
const AEC_CONTROL_NAME = "aec_control";
/** Shape of the tool's canonical output. Loose enough for all actions. */
const OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		ok: { type: "boolean" },
		action: { type: "string" },
		module: { type: "string" },
		data: {}
	},
	required: ["ok", "action"]
};
/** Render one canonical output value to model-facing content blocks. */
function renderOutput(value) {
	return [{
		type: "text",
		text: JSON.stringify(value, null, 2)
	}];
}
/**
* Build the `aec_control` tool definition.
* @param hub - the published hub service.
*/
function aecControlDefinition(hub) {
	return {
		name: AEC_CONTROL_NAME,
		description: "Control the PINNACLE MCP hub. Actions: status (hub summary), list (module table), enable <module> / disable <module> (toggle a module, governed by writeMode), probe <module> (test an MCP server connection), doctor (full diagnosis), discover (discovery results with confidence), audit (recent audit records), backups (retained snapshots per module). status/list/doctor/discover/audit/backups are safe; enable/disable/probe require confirmation under writeMode confirm and are refused under deny.",
		parameters: {
			action: {
				type: "string",
				required: true,
				description: "Action to perform: status | list | enable | disable | probe | doctor | discover | audit | backups."
			},
			module: {
				type: "string",
				description: "Module id (required for enable, disable, probe; optional filter for audit)."
			},
			limit: {
				type: "number",
				description: "Maximum number of audit records to return (audit action only)."
			},
			status: {
				type: "string",
				description: "Audit result filter: ok | failed | refused (audit action only)."
			}
		},
		output: {
			schema: OUTPUT_SCHEMA,
			render: (_args, value) => renderOutput(value)
		},
		async execute(args, exec) {
			const { action, module } = readAecArgs(args);
			try {
				switch (action) {
					case "status": {
						const status = hub.status();
						return {
							ok: status !== void 0,
							action,
							data: status === void 0 ? "hub service unavailable" : status
						};
					}
					case "list": {
						const status = hub.status();
						return {
							ok: status !== void 0,
							action,
							data: status === void 0 ? [] : status.modules
						};
					}
					case "enable": {
						if (module === void 0) return {
							ok: false,
							action,
							module,
							data: "module is required for enable"
						};
						const started = Date.now();
						try {
							const status = await hub.setEnabled(module, true);
							auditWrite({
								ts: (/* @__PURE__ */ new Date()).toISOString(),
								module,
								tool: "enable",
								decision: "allow",
								result: "ok",
								durationMs: Date.now() - started
							});
							return {
								ok: true,
								action,
								module,
								data: status
							};
						} catch (error) {
							auditWrite({
								ts: (/* @__PURE__ */ new Date()).toISOString(),
								module,
								tool: "enable",
								decision: "error",
								result: "failed",
								durationMs: Date.now() - started,
								detail: errorMessage(error)
							});
							return {
								ok: false,
								action,
								module,
								data: `error: ${errorMessage(error)}`
							};
						}
					}
					case "disable": {
						if (module === void 0) return {
							ok: false,
							action,
							module,
							data: "module is required for disable"
						};
						const started = Date.now();
						try {
							const status = await hub.setEnabled(module, false);
							auditWrite({
								ts: (/* @__PURE__ */ new Date()).toISOString(),
								module,
								tool: "disable",
								decision: "allow",
								result: "ok",
								durationMs: Date.now() - started
							});
							return {
								ok: true,
								action,
								module,
								data: status
							};
						} catch (error) {
							auditWrite({
								ts: (/* @__PURE__ */ new Date()).toISOString(),
								module,
								tool: "disable",
								decision: "error",
								result: "failed",
								durationMs: Date.now() - started,
								detail: errorMessage(error)
							});
							return {
								ok: false,
								action,
								module,
								data: `error: ${errorMessage(error)}`
							};
						}
					}
					case "probe": {
						if (module === void 0) return {
							ok: false,
							action,
							module,
							data: "module is required for probe"
						};
						const started = Date.now();
						try {
							const outcome = await hub.probe(module);
							auditWrite({
								ts: (/* @__PURE__ */ new Date()).toISOString(),
								module,
								tool: "probe",
								decision: "allow",
								result: outcome.ok ? "ok" : "failed",
								durationMs: Date.now() - started
							});
							return {
								ok: outcome.ok,
								action,
								module,
								data: outcome
							};
						} catch (error) {
							auditWrite({
								ts: (/* @__PURE__ */ new Date()).toISOString(),
								module,
								tool: "probe",
								decision: "error",
								result: "failed",
								durationMs: Date.now() - started,
								detail: errorMessage(error)
							});
							return {
								ok: false,
								action,
								module,
								data: `error: ${errorMessage(error)}`
							};
						}
					}
					case "doctor": return {
						ok: true,
						action,
						data: await hub.doctor()
					};
					case "discover": {
						const status = hub.status();
						return {
							ok: status !== void 0,
							action,
							data: status === void 0 ? [] : status.modules.map((m) => ({
								id: m.id,
								title: m.title,
								state: m.state,
								detail: m.detail,
								appGate: m.appGate,
								appRunning: m.appRunning
							}))
						};
					}
					case "audit": {
						const a = args;
						const limit = a !== void 0 && typeof a.limit === "number" ? a.limit : 50;
						return {
							ok: true,
							action,
							data: (await hub.audit(Math.max(limit, limit * 2))).filter((record) => (a?.module === void 0 || record.module === a.module) && (a?.status === void 0 || record.result === a.status)).slice(0, limit)
						};
					}
					case "backups": {
						const snapshots = hub.backups();
						return {
							ok: true,
							action,
							data: module === void 0 ? snapshots : snapshots.filter((s) => s.module === module)
						};
					}
					default: return {
						ok: false,
						action: action ?? "(none)",
						data: `unknown action: ${action ?? "missing"}. Use status | list | enable | disable | probe | doctor | discover | audit | backups.`
					};
				}
			} catch (error) {
				return {
					ok: false,
					action: action ?? "(none)",
					...module !== void 0 ? { module } : {},
					data: `error: ${errorMessage(error)}`
				};
			}
		}
	};
}
// src/index.ts
/**
* Host entry for the PINNACLE MCP hub. One `cordis.patch.yml` row loads this
* plugin, which validates its configuration, resolves the configured packs,
* starts the module supervisor, and publishes the `pinnacleHub` service every
* later hub feature hangs from (policy, audit, control tool, commands).
*
* A second activation in the same process is refused: two hubs would race the
* same MCP servers, the same policy state, and the same audit files, and the
* underlying tool registry would report a duplicate-name error that names the
* server rather than the real cause.
*
* @module @pinnacle/mcp-hub
*/
/** Service name the hub publishes; also the duplicate-load marker. */
const HUB_SERVICE = "pinnacleHub";
/** Plugin name; the Loader shows it in row diagnostics. */
const name = "pinnacle-mcp-hub";
/**
* Declared service edges. The hub deliberately injects nothing in this phase:
* it must load in profiles without tools, commands, or an approval service so
* the page and `doctor` can explain the gap instead of the row silently
* staying pending. `mcp-manager` is attached opportunistically when present.
*/
const inject = [];
/** The remedy appended to every duplicate-activation report. */
const ONE_HUB_REMEDY = "Keep exactly one pinnacle-mcp-hub row and restart dsh.";
/** Raised when the hub is activated twice in one process. */
var HubLoadError = class extends Error {
	/** @param message - an actionable description naming the duplicate row. */
	constructor(message) {
		super(message);
		this.name = "HubLoadError";
	}
};
/** Refuse a second activation when the sibling fiber already published the service. */
function assertNoActiveHub(ctx) {
	if (ctx.get("pinnacleHub") !== void 0) throw new HubLoadError(`pinnacle-mcp-hub: the hub is already loaded in this dsh process. ${ONE_HUB_REMEDY}`);
}
/**
* Publish the service, translating Cordis's duplicate-registration refusal into
* the hub's own message. A sibling row can pass the pre-check because Cordis
* registers services at activation, not at apply.
*/
function publishHub(ctx, service) {
	try {
		ctx.provide(HUB_SERVICE, service);
	} catch (error) {
		throw new HubLoadError(`pinnacle-mcp-hub: the hub is already loaded in this dsh process (${errorMessage(error)}). ${ONE_HUB_REMEDY}`);
	}
}
/** Build the service whose snapshot reads the live supervisor. */
function createService(deps) {
	const { settings, packs, supervisor, appGate, startedAt, lifecycle, approvalService } = deps;
	return {
		status: () => ({
			startedAt,
			config: settings,
			packs,
			modules: supervisor.snapshot(),
			stopped: lifecycle.stopped
		}),
		setEnabled: (id, enabled) => supervisor.setEnabled(id, enabled),
		probe: (id, options) => supervisor.probe(id, options),
		doctor: async () => {
			const discovery = await discoverModules(packs.flatMap((p) => p.manifest.modules), appGate);
			const environment = [];
			if (!approvalService) environment.push("No approval service present; write confirm/ask is refused.");
			return generateDoctor(packs.map((p) => ({
				packageName: p.packageName,
				modules: p.manifest.modules
			})), discovery, supervisor.snapshot(), approvalService, environment, deps.backupReport());
		},
		audit: (limit = 50) => Promise.resolve(auditRead(limit)),
		backups: () => listSnapshots()
	};
}
/** Build the model-facing failure that refuses a write without a snapshot. */
function backupFailure(moduleId, reason) {
	const message = `Backup before ${moduleId} write failed: ${reason} The write was refused.`;
	return {
		isError: true,
		content: [{
			type: "text",
			text: message
		}],
		error: {
			message,
			info: {
				name: "BackupError",
				code: "BACKUP_FAILED"
			}
		}
	};
}
/** Build `doctor` backup entries from the live registry, policy, and ledger. */
function buildBackupReport(modules, settings, state, tools) {
	return modules.map((module) => {
		const capability = resolveBackup(module, settings);
		const last = state.last(module.id);
		const issues = [];
		if (capability.kind === "unsupported") issues.push(capability.reason);
		if (capability.kind === "tool") {
			if (!(tools?.executable?.(`mcp__${module.id}__${capability.tool}`) !== void 0)) issues.push(`Backup tool ${capability.tool} is not registered; connect the module before writing.`);
		}
		if (capability.kind === "file" && !existsSync(capability.source)) issues.push(`Configured document is missing: ${capability.source}`);
		if (last?.status === "failed") issues.push(`Last snapshot failed: ${last.reason ?? "unknown error"}`);
		return {
			id: module.id,
			supported: module.backup.supported,
			capability: capability.kind,
			...capability.kind === "tool" ? { tool: capability.tool } : {},
			...last?.status === "created" ? { lastSnapshotAt: last.at } : {},
			...last?.status === "failed" && last.reason !== void 0 ? { lastError: last.reason } : {},
			issues
		};
	});
}
/**
* Validate configuration, start supervision, and publish the hub service.
* @param ctx - the owning plugin context.
* @param config - the `config` mapping of the hub row.
* @throws {HubLoadError} when a hub is already active in this process.
* @throws {HubConfigError} when the row is malformed.
* @throws {PackRegistryError} when a configured pack cannot be resolved.
*/
async function apply(ctx, config) {
	assertNoActiveHub(ctx);
	const settings = readHubConfig(config);
	const packs = await loadPacks(settings.packs);
	const startedAt = (/* @__PURE__ */ new Date()).toISOString();
	const appGate = createSystemAppGate();
	const supervisor = new Supervisor({
		modules: moduleSpecs(packs),
		pollMs: settings.defaults.pollMs,
		appGate
	});
	const lifecycle = { stopped: false };
	const approvalService = ctx.get("user-approval") !== void 0;
	const allModules = packs.flatMap((p) => p.manifest.modules);
	const modulesById = new Map(allModules.map((module) => [module.id, module]));
	const backupState = createBackupState();
	const backupLocks = serializeByKey();
	const lastSnapshotAt = /* @__PURE__ */ new Map();
	const appRunning = (moduleId) => supervisor.snapshot().find((module) => module.id === moduleId)?.appRunning === true;
	const catalog = () => ctx.get("tools");
	const identify = (toolName) => {
		const parsed = parseMcpToolName(toolName, modulesById);
		if (parsed === void 0) return void 0;
		const module = modulesById.get(parsed.moduleId);
		if (module === void 0) return void 0;
		return {
			moduleId: parsed.moduleId,
			kind: classifyTool(module, parsed.raw)
		};
	};
	const service = createService({
		settings,
		packs,
		supervisor,
		appGate,
		startedAt,
		lifecycle,
		approvalService,
		appRunning,
		backupReport: () => buildBackupReport(allModules, settings.backup, backupState, ctx.get("tools"))
	});
	publishHub(ctx, service);
	let controlCallId = 0;
	const runControlAction = async (action, module) => {
		const tools = ctx.get("tools");
		if (tools?.execute === void 0) throw new Error("The hub tool execution pipeline is unavailable.");
		const result = (await tools.execute({
			calls: [{
				type: "tool-call",
				id: `pinnacle-hub-ui-${++controlCallId}`,
				name: "aec_control",
				arguments: JSON.stringify({
					action,
					module
				})
			}],
			signal: new AbortController().signal
		})).results[0]?.result;
		if (result === void 0) throw new Error("The hub tool execution pipeline returned no result.");
		if (result.isError) throw new Error(result.error?.message ?? "The hub policy refused this action.");
		return result.value;
	};
	const hubRemote = new pinnacleHubRemote(service, runControlAction);
	ctx.provide(REMOTE_SERVICE_KEY, hubRemote);
	ctx.effect(() => () => {
		lifecycle.stopped = true;
		supervisor.stop();
	});
	ctx.on("mcp-manager/status", (name, status) => {
		supervisor.handleStatus(String(name), status);
	});
	const manager = ctx.get("mcpManager");
	if (manager !== void 0) supervisor.attachManager(manager);
	else ctx.inject(["mcpManager"], (child) => {
		const loaded = child.get("mcpManager");
		if (loaded !== void 0) supervisor.attachManager(loaded);
	});
	ctx.get("tools")?.register(aecControlDefinition(service));
	const disposeControlPolicy = ctx.on("tools/pre-execute", writePolicyListener(() => service.status(), approvalService));
	ctx.effect(() => disposeControlPolicy);
	const baseModulePolicy = moduleWriteListener(identify, () => service.status(), approvalService);
	const auditedModulePolicy = async (exec, next) => {
		const decision = await baseModulePolicy(exec, next);
		if (decision.kind === "deny" || decision.kind === "cancel") {
			const found = identify(exec.name);
			if (found !== void 0) auditWrite({
				ts: (/* @__PURE__ */ new Date()).toISOString(),
				module: found.moduleId,
				tool: exec.name,
				decision: "deny",
				result: "refused",
				durationMs: 0,
				...decision.reason === void 0 ? {} : { detail: decision.reason }
			});
		}
		return decision;
	};
	const disposeModulePolicy = ctx.on("tools/pre-execute", auditedModulePolicy);
	ctx.effect(() => disposeModulePolicy);
	const backupWrapper = async (exec, next) => {
		const parsed = parseMcpToolName(exec.name, modulesById);
		if (parsed === void 0) return next();
		const module = modulesById.get(parsed.moduleId);
		if (module === void 0) return next();
		if (classifyTool(module, parsed.raw) !== "write") return next();
		const capability = resolveBackup(module, settings.backup);
		const startedAtMs = Date.now();
		const at = (/* @__PURE__ */ new Date()).toISOString();
		if (capability.kind === "none") return next();
		if (capability.kind === "unsupported") {
			const event = {
				status: "unsupported",
				at,
				reason: capability.reason
			};
			backupState.record(module.id, event);
			const blocked = settings.backup.failure === "block";
			auditBackup(module.id, exec.name, event, Date.now() - startedAtMs, blocked ? "refused" : "allowed");
			if (blocked) return backupFailure(module.id, capability.reason);
			return next();
		}
		const previous = lastSnapshotAt.get(module.id);
		if (previous !== void 0 && settings.backup.dedupeMs > 0 && startedAtMs - previous < settings.backup.dedupeMs) {
			const event = {
				status: "skipped",
				at,
				reason: `Snapshot from ${Math.round((startedAtMs - previous) / 1e3)}s ago reused (backup.dedupeMs=${settings.backup.dedupeMs}).`
			};
			backupState.record(module.id, event);
			auditBackup(module.id, exec.name, event, 0, "allowed");
			return next();
		}
		const free = freeMegabytes();
		if (free < settings.backup.minFreeMb) {
			const event = {
				status: "skipped",
				at,
				reason: `Free space ${Math.round(free)} MB is below backup.minFreeMb=${settings.backup.minFreeMb}.`
			};
			backupState.record(module.id, event);
			const blocked = settings.backup.failure === "block";
			auditBackup(module.id, exec.name, event, 0, blocked ? "refused" : "allowed");
			if (blocked) return backupFailure(module.id, event.reason ?? "insufficient free space");
			return next();
		}
		let destination;
		try {
			destination = snapshotPath(module);
		} catch (error) {
			const event = {
				status: "failed",
				at,
				reason: errorMessage(error)
			};
			backupState.record(module.id, event);
			const blocked = settings.backup.failure === "block";
			auditBackup(module.id, exec.name, event, Date.now() - startedAtMs, blocked ? "refused" : "allowed");
			if (blocked) return backupFailure(module.id, event.reason ?? "snapshot path failed");
			return next();
		}
		const outcome = await backupLocks(module.id, () => takeSnapshot(module, capability, catalog(), settings.backup, destination, appRunning(module.id), exec.signal));
		const event = {
			status: outcome.status,
			at: (/* @__PURE__ */ new Date()).toISOString(),
			...outcome.reason === void 0 ? {} : { reason: outcome.reason },
			...outcome.path === void 0 ? {} : { path: outcome.path },
			...outcome.bytes === void 0 ? {} : { bytes: outcome.bytes },
			...outcome.tool === void 0 ? {} : { tool: outcome.tool }
		};
		if (outcome.status === "created") {
			lastSnapshotAt.set(module.id, Date.now());
			pruneSnapshots(module.id, settings.backup.keep);
		}
		backupState.record(module.id, event);
		const blocked = outcome.status !== "created" && settings.backup.failure === "block";
		auditBackup(module.id, exec.name, event, Date.now() - startedAtMs, blocked ? "refused" : "allowed");
		if (blocked) return backupFailure(module.id, outcome.reason ?? "snapshot was not created");
		return next();
	};
	const disposeBackup = ctx.on("tools/execute", backupWrapper);
	ctx.effect(() => disposeBackup);
	const postWriteAudit = async (exec, result, next) => {
		const found = identify(exec.name);
		if (found !== void 0 && found.kind !== "read") auditWrite({
			ts: (/* @__PURE__ */ new Date()).toISOString(),
			module: found.moduleId,
			tool: exec.name,
			decision: "allow",
			result: result.isError === true ? "failed" : "ok",
			durationMs: 0
		});
		return next();
	};
	const disposePostAudit = ctx.on("tools/post-execute", postWriteAudit);
	ctx.effect(() => disposePostAudit);
	await supervisor.start();
}
export { HUB_SERVICE, HubLoadError, apply, inject, name };

//# sourceMappingURL=index.js.map