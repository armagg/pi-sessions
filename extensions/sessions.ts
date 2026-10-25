/**
 * Session browser for pi.
 *
 * Adds:
 * - /sessions [all] [N] [today|7d|YYYY-MM-DD] [query] — picker over saved
 *   sessions with resume, preview, and copy actions.
 * - recent_sessions tool — the same listing, filterable, for the model.
 * - session_transcript tool — read one session's messages by id or path.
 *
 * Everything reads through SessionManager exported by the host package, so it
 * follows the session dir/cwd rules of the running pi. No dependencies.
 */

import { existsSync } from "node:fs";
import { basename } from "node:path";
import {
	copyToClipboard,
	SessionManager,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const PREVIEW_MESSAGES = 12;
const PREVIEW_CHARS = 400;
const TRANSCRIPT_MESSAGES = 20;
const TRANSCRIPT_CHARS = 500;
const MAX_MESSAGE_CHARS = 4_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Structural view of a session message. The real types live in host packages. */
interface ContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

interface TranscriptMessage {
	role: string;
	timestamp?: number;
	content?: string | ContentBlock[];
	toolName?: string;
	isError?: boolean;
	command?: string;
	output?: string;
	exitCode?: number;
	summary?: string;
	customType?: string;
}

interface Filters {
	query?: string;
	project?: string;
	fullText?: boolean;
	since?: Date;
	until?: Date;
}

/** Structured details for the two tool results (kept uniform so both paths typecheck). */
interface ListDetails {
	count: number;
	total: number;
	offset: number;
	limit: number;
	all: boolean;
	error?: string;
}

interface TranscriptDetails {
	id?: string;
	path?: string;
	/** Messages on the active branch (what this transcript renders). */
	total?: number;
	/** Message entries in the file, including other branches. */
	fileTotal?: number;
	/** How many messages were actually rendered. */
	shown?: number;
	/** Original index of the first rendered message. */
	from?: number;
	/** Original index of the last rendered message. */
	to?: number;
	offset?: number;
	error?: string;
}

/** A session plus the full-text match that found it, if any. */
interface Hit {
	session: SessionInfo;
	snippet?: string;
}

// ---------------------------------------------------------------- formatting

function relativeTime(date: Date): string {
	const diffMs = Date.now() - date.getTime();
	if (!Number.isFinite(diffMs)) return "?";
	const minutes = Math.floor(diffMs / MINUTE);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return date.toISOString().slice(0, 10);
}

function collapse(text: string): string {
	return text.replace(/\s+/gu, " ").trim();
}

function truncate(text: string, max: number): string {
	const flat = collapse(text);
	if (flat.length <= max) return flat;
	return `${flat.slice(0, Math.max(1, max - 1))}…`;
}

/** One listing line: when, id, size, optional project, then a text preview. */
function formatLine(hit: Hit, options: { project?: "full" | "short"; text?: string } = {}): string {
	const { session } = hit;
	const name = session.name ? ` [${session.name}]` : "";
	const cwd = options.project === "short" ? session.cwd.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~") : session.cwd;
	const project = options.project ? `  ${cwd}` : "";
	const text = options.text ?? truncate(session.firstMessage, 60);
	return `${relativeTime(session.modified).padEnd(9)} ${session.id.slice(0, 8)}${name}  ${session.messageCount} msgs${project}  ${text}`;
}

/** Context around the first full-text match, for search results. */
function findSnippet(text: string, query: string, radius = 60): string | undefined {
	const index = text.toLowerCase().indexOf(query);
	if (index < 0) return undefined;
	const start = Math.max(0, index - radius);
	const end = Math.min(text.length, index + query.length + radius);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < text.length ? "…" : "";
	return `${prefix}${collapse(text.slice(start, end))}${suffix}`;
}

// ------------------------------------------------------------------ querying

async function loadSessions(all: boolean, signal?: AbortSignal): Promise<SessionInfo[]> {
	return all
		? await SessionManager.listAll(undefined, undefined, signal)
		: await SessionManager.list(process.cwd(), undefined, undefined, signal);
}

/**
 * Look up the SessionInfo for an already-resolved path. Costs one directory scan,
 * so callers only use it when the listing gives us extra facts (file message count,
 * session name) that the header wants to report.
 */
async function findInfoByPath(path: string, signal?: AbortSignal): Promise<SessionInfo | undefined> {
	try {
		const sessions = await loadSessions(true, signal);
		return sessions.find((session) => session.path === path);
	} catch {
		return undefined;
	}
}

function applyFilters(sessions: SessionInfo[], filters: Filters): Hit[] {
	const query = filters.query?.toLowerCase();
	const project = filters.project?.toLowerCase();
	const hits: Hit[] = [];
	for (const session of sessions) {
		if (project && !session.cwd.toLowerCase().includes(project) && !(session.name ?? "").toLowerCase().includes(project)) {
			continue;
		}
		if (filters.since && session.modified < filters.since) continue;
		if (filters.until && session.modified > filters.until) continue;
		if (!query) {
			hits.push({ session });
			continue;
		}
		const haystack = `${session.id} ${session.name ?? ""} ${session.cwd} ${session.firstMessage}`.toLowerCase();
		if (haystack.includes(query)) {
			hits.push({ session });
			continue;
		}
		if (filters.fullText) {
			const snippet = findSnippet(session.allMessagesText ?? "", query);
			if (snippet) hits.push({ session, snippet });
		}
	}
	return hits;
}

function clampLimit(value: unknown, fallback: number, max = MAX_LIMIT): number {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.min(Math.floor(parsed), max);
}

/**
 * Parse a time token: relative ("today", "yesterday", "week", "3d", "24h", "30m")
 * or absolute ("2026-10-01", any Date.parse input). Date-only values are treated
 * as the start of that day.
 */
function parseTimeToken(token: string): Date | undefined {
	const lower = token.toLowerCase();
	const now = new Date();
	if (lower === "today") return startOfToday();
	if (lower === "yesterday") return new Date(startOfToday().getTime() - DAY);
	if (lower === "week") return new Date(now.getTime() - WEEK);
	const relative = /^(\d+)([mhdw])$/.exec(lower);
	if (relative) {
		const units: Record<string, number> = { m: MINUTE, h: HOUR, d: DAY, w: WEEK };
		return new Date(now.getTime() - Number(relative[1]) * units[relative[2]!]);
	}
	const absolute = Date.parse(token);
	return Number.isNaN(absolute) ? undefined : new Date(absolute);
}

function isDateOnly(token: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(token);
}

function startOfToday(): Date {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// ---------------------------------------------------------------- transcripts

function messageText(message: TranscriptMessage): string {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text ?? "")
		.join("\n");
}

function compactArgs(args: Record<string, unknown> | undefined, max = 120): string {
	if (!args) return "";
	try {
		return truncate(JSON.stringify(args), max);
	} catch {
		return "";
	}
}

/** One message selected for rendering, carrying its original index in the branch. */
interface TranscriptEntry {
	index: number;
	message: TranscriptMessage;
}

/**
 * Whether a message produces any output at all. Selection and rendering must agree
 * on this, otherwise the header advertises messages the body does not contain.
 */
function isRenderable(message: TranscriptMessage, toolCalls: boolean): boolean {
	switch (message.role) {
		case "user":
		case "custom":
			return messageText(message) !== "";
		case "assistant": {
			if (messageText(message) !== "") return true;
			const blocks = Array.isArray(message.content) ? message.content : [];
			if (blocks.some((block) => block.type === "thinking")) return true;
			return toolCalls && blocks.some((block) => block.type === "toolCall");
		}
		case "toolResult":
		case "bashExecution":
			return toolCalls;
		case "compactionSummary":
		case "branchSummary":
			return true;
		default:
			return false;
	}
}

/**
 * Render messages as readable text: a header per message, its text, and compact
 * one-liners for tool calls and results. Thinking blocks are counted, not shown.
 */
function formatTranscript(entries: TranscriptEntry[], maxChars: number, toolCalls: boolean): string {
	const lines: string[] = [];
	for (const { index: position, message } of entries) {
		const when = typeof message.timestamp === "number" ? new Date(message.timestamp).toISOString().slice(0, 16).replace("T", " ") : "";
		switch (message.role) {
			case "user": {
				const text = truncate(messageText(message), maxChars);
				if (text) lines.push(`[${position}] user · ${when}`, text, "");
				break;
			}
			case "assistant": {
				const blocks = Array.isArray(message.content) ? message.content : [];
				const text = truncate(messageText(message), maxChars);
				const thinking = blocks.filter((block) => block.type === "thinking").length;
				const calls = toolCalls ? blocks.filter((block) => block.type === "toolCall") : [];
				if (!text && thinking === 0 && calls.length === 0) break;
				lines.push(`[${position}] assistant · ${when}${thinking > 0 ? ` (${thinking} thinking)` : ""}`);
				if (text) lines.push(text);
				for (const call of calls) {
					const args = compactArgs(call.arguments);
					lines.push(`  ↳ tool ${call.name ?? "?"}${args ? ` ${args}` : ""}`);
				}
				lines.push("");
				break;
			}
			case "toolResult": {
				if (!toolCalls) break;
				const text = truncate(messageText(message), 120);
				lines.push(`  ↳ result ${message.toolName ?? ""} ${message.isError ? "error" : "ok"}${text ? `: ${text}` : ""}`);
				break;
			}
			case "bashExecution": {
				if (!toolCalls) break;
				const status = message.exitCode === 0 || message.exitCode === undefined ? "" : ` (exit ${message.exitCode})`;
				lines.push(
					`[${position}] bash · ${when}${status}`,
					`$ ${truncate(message.command ?? "", maxChars)}`,
					truncate(message.output ?? "", Math.min(maxChars, 300)),
					"",
				);
				break;
			}
			case "compactionSummary":
			case "branchSummary": {
				lines.push(`[${position}] ${message.role} · ${when}`, truncate(message.summary ?? "", maxChars), "");
				break;
			}
			case "custom": {
				const text = truncate(messageText(message), maxChars);
				if (text) lines.push(`[${position}] ${message.customType ?? "custom"} · ${when}`, text, "");
				break;
			}
			default:
				break;
		}
	}
	return lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd();
}

/** Open one session file and render its active branch. */
function readTranscript(
	path: string,
	options: { limit: number; offset: number; maxChars: number; toolCalls: boolean },
): { text: string; total: number; shown: number; from: number; to: number; id: string; cwd: string } {
	const manager = SessionManager.open(path);
	const messages = manager.buildSessionContext().messages as unknown as TranscriptMessage[];
	const total = messages.length;

	// Page over renderable messages only, so "showing N" matches the body exactly.
	const renderable: TranscriptEntry[] = [];
	messages.forEach((message, index) => {
		if (isRenderable(message, options.toolCalls)) renderable.push({ index, message });
	});

	// Group each tool result under the message that produced it, so a window never
	// starts with an orphaned "↳ result" whose parent fell outside the range, and so
	// `limit`/`offset` count real messages rather than continuation lines.
	const units: TranscriptEntry[][] = [];
	for (const entry of renderable) {
		const last = units[units.length - 1];
		if (entry.message.role === "toolResult" && last) last.push(entry);
		else units.push([entry]);
	}

	const end = Math.max(0, units.length - options.offset);
	const start = Math.max(0, end - options.limit);
	const pickedUnits = units.slice(start, end);
	const picked = pickedUnits.flat();

	const header = manager.getHeader();
	return {
		text: formatTranscript(picked, options.maxChars, options.toolCalls),
		total,
		shown: pickedUnits.length,
		from: picked[0]?.index ?? -1,
		to: picked[picked.length - 1]?.index ?? -1,
		id: header?.id ?? basename(path),
		cwd: header?.cwd ?? "",
	};
}

/** Resolve "id | id prefix | path" to a session file path. */
async function resolveSessionRef(
	ref: string,
	signal?: AbortSignal,
): Promise<{ path: string; info?: SessionInfo } | { error: string }> {
	const trimmed = ref.trim();
	if (!trimmed) return { error: "No session reference given." };
	if (trimmed.includes("/") || trimmed.endsWith(".jsonl")) {
		return existsSync(trimmed)
			? { path: trimmed }
			: { error: `No session file at ${trimmed}. Pass a session id from recent_sessions, or an existing path.` };
	}
	const exact = SessionManager.findById(process.cwd(), trimmed);
	if (exact) return { path: exact };
	const needle = trimmed.toLowerCase().replace(/-/gu, "");
	if (needle.length < 4) return { error: `Session id prefixes need at least 4 characters (got "${trimmed}").` };
	const matches = (await loadSessions(true, signal)).filter((session) => session.id.toLowerCase().replace(/-/gu, "").startsWith(needle));
	if (matches.length === 1) return { path: matches[0]!.path, info: matches[0] };
	if (matches.length === 0) {
		return { error: `No session id starts with "${trimmed}". Use recent_sessions to list sessions first.` };
	}
	const candidates = matches.slice(0, 8).map((session) => `${session.id} (${relativeTime(session.modified)}, ${session.messageCount} msgs)`);
	return { error: `"${trimmed}" matches ${matches.length} sessions; use a longer prefix. Candidates: ${candidates.join("; ")}` };
}

// ------------------------------------------------------------------- command

function parseCommandArgs(raw: string): { all: boolean; limit: number; filters: Filters } {
	const filters: Filters = {};
	let all = false;
	let limit = DEFAULT_LIMIT;
	const words: string[] = [];
	for (const token of raw.split(/\s+/).filter(Boolean)) {
		const lower = token.toLowerCase();
		if (lower === "all" || lower === "--all") {
			all = true;
			continue;
		}
		if (/^\d+$/.test(token)) {
			limit = clampLimit(Number(token), DEFAULT_LIMIT);
			continue;
		}
		if (lower === "yesterday") {
			const start = new Date(startOfToday().getTime() - DAY);
			filters.since = start;
			filters.until = startOfToday();
			continue;
		}
		const since = parseTimeToken(token);
		if (since && !filters.since) {
			filters.since = since;
			continue;
		}
		words.push(token);
	}
	if (words.length > 0) filters.query = words.join(" ");
	return { all, limit, filters };
}

function piBinary(): string {
	const argv1 = process.argv[1];
	const name = argv1 ? basename(argv1) : "";
	// A compiled pi is argv[1]; under a wrapper it can be something unrelated, so
	// only accept a pi-looking name.
	return /^pi(-[a-z0-9]+)?$/i.test(name) ? name : "pi";
}

async function copy(text: string, ctx: ExtensionCommandContext): Promise<void> {
	try {
		await copyToClipboard(text);
		ctx.ui.notify(`Copied: ${truncate(text, 120)}`, "info");
	} catch {
		ctx.ui.pasteToEditor(text);
		ctx.ui.notify("Clipboard unavailable — pasted into the editor instead", "warning");
	}
}

export default function sessionsExtension(pi: ExtensionAPI) {
	pi.registerCommand("sessions", {
		description: "Browse saved sessions: /sessions [all] [N] [today|7d|YYYY-MM-DD] [query]",
		getArgumentCompletions: (prefix) => {
			const options = ["all", "all 50", "today", "yesterday", "7d", "30d", "50"];
			const typed = prefix.trim().toLowerCase();
			const matches = options.filter((option) => option.startsWith(typed));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const { all, limit, filters } = parseCommandArgs(args);
			// The picker searches transcript bodies too: the text is already in memory
			// once sessions are listed, and a match shows as the row's snippet.
			if (filters.query) filters.fullText = true;
			const hits = applyFilters(await loadSessions(all), filters);
			if (hits.length === 0) {
				ctx.ui.notify(filters.query ? `No sessions match "${filters.query}"` : "No sessions found", "info");
				return;
			}
			const shown = hits.slice(0, limit);
			let hit: Hit | undefined;
			if (shown.length === 1 && filters.query) {
				// A query that narrows to one session goes straight to its actions.
				hit = shown[0];
			} else {
				const lines = shown.map((session, index) => {
					const number = `${index + 1}`.padStart(3, " ");
					const line = formatLine(session, {
						project: all || filters.project !== undefined ? "short" : undefined,
						text: session.snippet ?? undefined,
					});
					return `${number}. ${line}`;
				});
				const title = `Sessions${all ? " (all projects)" : " (this project)"} — ${shown.length} of ${hits.length}`;
				const selected = await ctx.ui.select(title, lines);
				if (!selected) return;
				hit = shown[Number.parseInt(selected.trim(), 10) - 1];
			}
			if (!hit) return;
			const { session } = hit;

			const actions: string[] = [];
			const canResume = ctx.mode === "tui" && typeof ctx.switchSession === "function";
			if (canResume) actions.push("Resume this session");
			actions.push("Preview last messages", "Copy file path", `Copy "${piBinary()} --session …" command`);
			const action = await ctx.ui.select(`${session.id.slice(0, 8)} · ${session.messageCount} msgs · ${relativeTime(session.modified)}`, actions);
			if (!action) return;

			if (action === "Resume this session") {
				// ctx is invalid after switchSession — do nothing else here.
				await ctx.switchSession(session.path);
				return;
			}
			if (action === "Preview last messages") {
				let text: string;
				try {
					const preview = readTranscript(session.path, {
						limit: PREVIEW_MESSAGES,
						offset: 0,
						maxChars: PREVIEW_CHARS,
						toolCalls: true,
					});
					text = preview.text || "(no messages)";
				} catch (error) {
					text = `Could not read this session: ${error instanceof Error ? error.message : String(error)}`;
				}
				await ctx.ui.editor(`Preview ${session.id.slice(0, 8)} — last ${PREVIEW_MESSAGES} messages (close to discard)`, text);
				return;
			}
			if (action === "Copy file path") {
				await copy(session.path, ctx);
				return;
			}
			await copy(`${piBinary()} --session ${session.path}`, ctx);
		},
	});

	pi.registerTool({
		name: "recent_sessions",
		label: "Recent Sessions",
		description:
			"List the user's saved pi sessions, newest first, with optional filters. Returns relative time, short id, name, message count, project, and the first message of each session. Use session_transcript with a short id to read one of them.",
		promptSnippet: "List/search saved pi sessions (filters: project, query, fullText, since/until)",
		parameters: Type.Object({
			all: Type.Optional(Type.Boolean({ description: "Search every project instead of only the current one. Implied by project. Default false." })),
			limit: Type.Optional(Type.Number({ description: `Maximum sessions to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` })),
			offset: Type.Optional(Type.Number({ description: "Skip this many matching sessions, to page through results. Default 0." })),
			project: Type.Optional(Type.String({ description: "Substring of the project path or session name, e.g. \"insomnix\" or \"~/my-project\"." })),
			query: Type.Optional(Type.String({ description: "Case-insensitive substring to match against session id, name, project path, and first message." })),
			fullText: Type.Optional(Type.Boolean({ description: "Also search inside session transcripts for query, and return the matched passage. Slower but finds sessions by content. Default false." })),
			since: Type.Optional(Type.String({ description: "Only sessions modified at or after this time: \"today\", \"yesterday\", \"7d\", \"24h\", or a date like \"2026-10-01\"." })),
			until: Type.Optional(Type.String({ description: "Only sessions modified at or before this time (same formats as since)." })),
			details: Type.Optional(Type.Boolean({ description: "Include full session ids, file paths, and exact timestamps. Default false." })),
		}),
		async execute(_toolCallId, params, signal) {
			const limit = clampLimit(params.limit, DEFAULT_LIMIT);
			const offset = Math.max(0, Math.floor(params.offset ?? 0));
			const filters: Filters = {
				project: params.project,
				query: params.query,
				fullText: params.fullText === true,
			};
			const all = params.all === true || filters.project !== undefined;
			const badTime = (field: string, value: string) => {
				const details: ListDetails = { count: 0, total: 0, offset, limit, all, error: `bad-${field}` };
				return {
					content: [{ type: "text" as const, text: `Could not parse ${field}="${value}". Use "today", "yesterday", "7d", "24h", or a date like "2026-10-01".` }],
					details,
					isError: true,
				};
			};
			if (params.since) {
				const since = parseTimeToken(params.since);
				if (!since) return badTime("since", params.since);
				filters.since = since;
			}
			if (params.until) {
				const until = parseTimeToken(params.until);
				if (!until) return badTime("until", params.until);
				// A date-only upper bound means "through the end of that day".
				filters.until = isDateOnly(params.until) ? new Date(until.getTime() + DAY - 1) : until;
			}
			const hits = applyFilters(await loadSessions(all, signal), filters);
			const shown = hits.slice(offset, offset + limit);
			if (shown.length === 0) {
				const scope = all ? "any project" : "the current project";
				const reason = [filters.query ? `matching "${filters.query}"` : "", filters.project ? `in project "${filters.project}"` : "", params.since ? `since ${params.since}` : ""]
					.filter(Boolean)
					.join(" ");
				const details: ListDetails = { count: 0, total: 0, offset, limit, all };
				return {
					content: [{ type: "text", text: `No sessions in ${scope}${reason ? ` ${reason}` : ""}.` }],
					details,
				};
			}
			const lines = shown.map((hit) => {
				const line = formatLine(hit, { project: all ? "full" : undefined, text: hit.snippet ?? undefined });
				if (!params.details) return line;
				const { session } = hit;
				return `${line}\n    id: ${session.id}\n    path: ${session.path}\n    created: ${session.created.toISOString()}  modified: ${session.modified.toISOString()}`;
			});
			const header = `${hits.length} session${hits.length === 1 ? "" : "s"} matched, showing ${offset + 1}-${offset + shown.length}${all ? " (all projects)" : " (current project)"}`;
			const details: ListDetails = { count: shown.length, total: hits.length, offset, limit, all };
			return {
				content: [{ type: "text", text: `${header}\n${lines.join("\n")}` }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "session_transcript",
		label: "Session Transcript",
		description:
			"Read the messages of one saved pi session as text. Accepts a session id, a unique id prefix from recent_sessions, or a session file path. Returns the most recent messages with timestamps, user/assistant text, and compact tool call/result lines. Page backwards with offset.",
		promptSnippet: "Read one saved pi session by id or path (paged, newest last)",
		parameters: Type.Object({
			session: Type.String({ description: "Session id, unique id prefix (4+ chars), or path to a session .jsonl file." }),
			limit: Type.Optional(Type.Number({ description: `Maximum messages to return, counted from the end (default ${TRANSCRIPT_MESSAGES}, max ${MAX_LIMIT}).` })),
			offset: Type.Optional(Type.Number({ description: "Skip this many messages from the end to page backwards. Default 0." })),
			maxChars: Type.Optional(Type.Number({ description: `Truncate each message to this many characters (default ${TRANSCRIPT_CHARS}).` })),
			toolCalls: Type.Optional(Type.Boolean({ description: "Include tool call/result lines. Default true." })),
		}),
		async execute(_toolCallId, params, signal) {
			const resolved = await resolveSessionRef(params.session, signal);
			if ("error" in resolved) {
				const details: TranscriptDetails = { error: resolved.error };
				return { content: [{ type: "text", text: resolved.error }], details, isError: true };
			}
			const info = resolved.info ?? (await findInfoByPath(resolved.path, signal));
			const limit = clampLimit(params.limit, TRANSCRIPT_MESSAGES);
			const offset = Math.max(0, Math.floor(params.offset ?? 0));
			try {
				const transcript = readTranscript(resolved.path, {
					limit,
					offset,
					maxChars: clampLimit(params.maxChars, TRANSCRIPT_CHARS, MAX_MESSAGE_CHARS),
					toolCalls: params.toolCalls !== false,
				});
				// list() counts message entries across every branch; the transcript renders
				// the active branch only. Label them separately so the numbers reconcile.
				const fileTotal = info?.messageCount;
				const branchNote =
					typeof fileTotal === "number" && fileTotal !== transcript.total
						? ` (${fileTotal} message entries in the file, including other branches)`
						: "";
				const range =
					transcript.shown > 0 ? `, showing ${transcript.shown} at indices ${transcript.from}-${transcript.to}` : ", nothing to show here";
				const header = [
					`Session ${transcript.id}`,
					info?.name ? `Name: ${info.name}` : undefined,
					`Project: ${transcript.cwd}`,
					`File: ${resolved.path}`,
					`Messages: ${transcript.total} on the active branch${branchNote}${range}${offset > 0 ? ` (offset ${offset} from the end)` : ""}`,
				]
					.filter(Boolean)
					.join("\n");
				const body =
					transcript.text ||
					(transcript.total === 0
						? "(no messages)"
						: `(no renderable messages at offset ${offset}${params.toolCalls === false ? "; toolCalls is false, so tool-only messages are hidden" : ""})`);
				const details: TranscriptDetails = {
					id: transcript.id,
					path: resolved.path,
					total: transcript.total,
					fileTotal,
					shown: transcript.shown,
					from: transcript.from,
					to: transcript.to,
					offset,
				};
				return {
					content: [{ type: "text", text: `${header}\n${"-".repeat(40)}\n${body}` }],
					details,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const details: TranscriptDetails = { path: resolved.path, error: message };
				return { content: [{ type: "text", text: `Could not read ${resolved.path}: ${message}` }], details, isError: true };
			}
		},
	});
}
