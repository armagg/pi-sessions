# pi-sessions

A small [pi](https://github.com/earendil-works/pi) package for looking at your
old sessions without leaving the editor.

pi already keeps every conversation as a session file, but the only built-in
way to browse them is the `--resume` picker at startup. This adds two things
to sessions you're already in:

- `/sessions` — a picker with your most recent sessions for the current
  project, newest first. `/sessions all` does the same across every project.
  Selecting an entry shows its full id and file path (handy for
  `pi --session <path>`).
- a `recent_sessions` tool — lets the model pull the same listing, so you can
  just ask "what did I work on yesterday?" and get an answer based on actual
  session history instead of guesswork.

Each line shows the relative time, id prefix, session name (if you named it),
message count, and the first message of the conversation.

## Install

```bash
pi install git:github.com/armagg/pi-sessions
```

Pull updates with `pi update --extensions`.

## Notes

- The listing uses the same `SessionManager` your pi uses, so it respects
  `--session-dir`, named sessions, and the usual cwd rules. If a future pi
  release changes that API, this package needs a matching bump — file an
  issue if it breaks.
- The tool is called `recent_sessions` because `pi-total-recall` already
  registers `session_list`. If you run both, they don't conflict.
- Sessions for the current project are matched by cwd, same as the resume
  picker. If you started pi somewhere else, use `/sessions all`.

## License

MIT
