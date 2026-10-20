# pi-session-lens

[![npm](https://img.shields.io/npm/v/pi-session-lens)](https://www.npmjs.com/package/pi-session-lens)
[![license](https://img.shields.io/npm/l/pi-session-lens)](https://github.com/armagg/pi-sessions/blob/main/LICENSE)

A small [pi](https://github.com/earendil-works/pi) package for browsing your old
sessions without leaving the one you're in. One TypeScript file, no
dependencies.

pi saves every conversation as a session file, but the built-in ways to look at
them are the `--resume` picker at startup and `/resume` in a running session.
This adds a search-first picker and two model-callable tools:

| What | Why |
|---|---|
| `/sessions [all] [N] [today\|7d\|YYYY-MM-DD] [query]` | Filter first, then act: resume, preview, or copy a path |
| `recent_sessions` tool | The model can answer "what did I work on yesterday?" from real history |
| `session_transcript` tool | The model can read one of those sessions by id or path |

## Install

```bash
pi install npm:pi-session-lens
```

From git, or for one invocation only:

```bash
pi install git:github.com/armagg/pi-sessions
pi -e npm:pi-session-lens
```

Pull updates with `pi update --extensions`.

## `/sessions`

```text
/sessions                     # 20 most recent sessions for this project
/sessions all                 # every project
/sessions today               # only sessions touched today
/sessions all 50 insomnix     # every project, up to 50, matching "insomnix"
/sessions 7d ramzinex delta   # last 7 days, matching "ramzinex delta"
```

Tokens are positional-free: `all` sets the scope, a bare number sets the limit,
`today` / `yesterday` / `week` / `30m` / `24h` / `7d` / `2w` / `2026-10-01`
sets a lower time bound, and anything else becomes the search text. A row
matches when the text appears in its id, name, project path, or first message —
and otherwise when it appears anywhere in the transcript, in which case the row
shows the matched passage instead of the first message.

Each row shows relative time, id prefix, session name, message count, project
(when the scope is wider than one project), and the first message. Picking a row
offers:

- **Resume this session** — switches the running pi to it (`switchSession`),
  across projects too. Interactive mode only.
- **Preview last messages** — the last 12 messages in an editor pane, closed
  without side effects.
- **Copy file path** / **Copy `pi --session …` command** — to the clipboard, so
  you can open the same session in another terminal.

A query that matches exactly one session skips the list and opens its actions
directly, so `/sessions 01a15886` is a two-keystroke resume.

`/resume` is still the better tool for renaming or deleting sessions; this one
is for finding a session by what it was about and jumping straight into it.

## Tools

`recent_sessions` — listing with filters:

| Parameter | Meaning |
|---|---|
| `all` | Every project instead of the current one (implied by `project`) |
| `limit`, `offset` | Page through results (default 20, max 200) |
| `project` | Substring of the project path or session name |
| `query` | Case-insensitive substring: id, name, path, first message |
| `fullText` | Also search transcript bodies; returns the matched passage |
| `since`, `until` | `today`, `7d`, `24h`, or `2026-10-01` |
| `details` | Full ids, file paths, and exact timestamps |

`session_transcript` — read one session:

| Parameter | Meaning |
|---|---|
| `session` | Session id, unique id prefix (4+ chars), or `.jsonl` path |
| `limit`, `offset` | Messages from the end; `offset` pages backwards |
| `maxChars` | Per-message truncation (default 500) |
| `toolCalls` | Compact tool call/result lines (default true) |

Output is the session's active branch, so compaction summaries appear where pi
put them and abandoned branches stay out.

```text
Session 01a15886-b1c2-77bd-a78e-017d52b6951b
Project: /Users/omid/my-project/pi-sessions
File: /Users/omid/.pi/agent/sessions/…jsonl
Messages: 99 total, showing 95-98
----------------------------------------
[96] assistant · 2026-10-20 09:18 (1 thinking)
  ↳ tool bash {"command":"tsc --noEmit"}
  ↳ result bash ok: tsc done
```

## Notes

- Sessions are read through the host's `SessionManager`, so `--session-dir`,
  `sessionDir`, named sessions, and the usual cwd rules all apply. Listing every
  project reads every session file: ~0.5s for 170 sessions / 300MB here.
- The tool is called `recent_sessions`, not `session_list`, so it does not
  collide with `pi-total-recall`. If you run both, `session_transcript` and
  `session_read` are similarly independent.
- No runtime dependencies. `@earendil-works/pi-coding-agent` and `typebox` are
  host-provided peers.

## Development

```bash
npm install
npm run typecheck
pi -e ./extensions/sessions.ts
```

Releases are published to npm by `.github/workflows/publish.yml` on a `v*` tag,
which is also what makes the package show up in the
[Pi package gallery](https://pi.dev/packages) (the `pi-package` keyword is what
the gallery indexes).

## License

MIT
