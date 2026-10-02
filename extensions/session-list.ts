/**
 * List saved pi sessions from inside pi.
 *
 * Adds:
 * - /sessions [all] slash command: shows recent sessions for the current
 *   project (or all projects with "all"), newest first.
 * - recent_sessions tool: model-callable, returns the same listing as text.
 *
 * Reads sessions through SessionManager exported by the host package, so it
 * follows whatever session dir/cwd rules the running pi uses.
 */

import { SessionManager, type ExtensionAPI, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_LIMIT = 20;

function relativeTime(date: Date): string {
	const diffMs = Date.now() - date.getTime();
	if (!Number.isFinite(diffMs)) return "?";
	const minutes = Math.floor(diffMs / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function firstMessage(session: SessionInfo, maxLength = 60): string {
	const text = session.firstMessage.replace(/\s+/gu, " ").trim();
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 1)}…`;
}

function formatLine(session: SessionInfo, showProject: boolean): string {
	const when = relativeTime(session.modified);
	const id = session.id.slice(0, 8);
	const msgs = session.messageCount;
	const name = session.name ? ` [${session.name}]` : "";
	const project = showProject ? `  ${session.cwd}` : "";
	return `${when.padEnd(9)}  ${id}${name}  ${msgs} msgs${project}  ${firstMessage(session)}`;
}

async function listSessions(all: boolean): Promise<SessionInfo[]> {
	const sessions = all
		? await SessionManager.listAll()
		: await SessionManager.list(process.cwd());
	return sessions.slice(0, DEFAULT_LIMIT);
}

export default function sessionsExtension(pi: ExtensionAPI) {
	pi.registerCommand("sessions", {
		description: "List recent sessions (use '/sessions all' for every project)",
		handler: async (args, ctx) => {
			const all = args.trim().toLowerCase() === "all";
			const sessions = await listSessions(all);
			if (sessions.length === 0) {
				ctx.ui.notify("No sessions found", "info");
				return;
			}
			const lines = sessions.map((session) => formatLine(session, all));
			const selected = await ctx.ui.select(
				all ? "Sessions (all projects)" : "Sessions (this project)",
				lines,
			);
			if (!selected) return;
			const index = lines.indexOf(selected);
			const session = sessions[index];
			if (session) {
				ctx.ui.notify(`${session.id}\n${session.path}`, "info");
			}
		},
	});

	pi.registerTool({
		name: "recent_sessions",
		label: "Session List",
		description:
			"List the user's recent pi sessions, newest first. Returns id, name, project cwd, message count, and the first message of each session.",
		promptSnippet: "List recent pi sessions",
		parameters: Type.Object({
			all: Type.Optional(
				Type.Boolean({ description: "Include sessions from all projects, not just the current one. Default false." }),
			),
			limit: Type.Optional(
				Type.Number({ description: `Maximum sessions to return (default ${DEFAULT_LIMIT}).` }),
			),
		}),
		async execute(_toolCallId, params) {
			const all = params.all === true;
			const limit = typeof params.limit === "number" && params.limit > 0 ? params.limit : DEFAULT_LIMIT;
			const sessions = (await listSessions(all)).slice(0, limit);
			if (sessions.length === 0) {
				return {
					content: [{ type: "text", text: all ? "No sessions found." : "No sessions found for the current project." }],
					details: { count: 0 },
				};
			}
			const text = sessions.map((session) => formatLine(session, all)).join("\n");
			return {
				content: [{ type: "text", text }],
				details: { count: sessions.length },
			};
		},
	});
}
