# pi-sessions

A [pi](https://github.com/earendil-works/pi) package that lists your saved
sessions from inside pi.

Adds two things:

- `/sessions` slash command: shows the most recent sessions for the current
  project in a picker, newest first. Selecting one shows its full id and file
  path. Use `/sessions all` to list sessions from every project.
- `recent_sessions` tool: model-callable, returns the same listing as text so
  the agent can answer questions like "which sessions did I work on recently?"

## Install

```bash
pi install git:github.com/armagg/pi-sessions
```

Update later with:

```bash
pi update --extensions
```

## How it works

Sessions are read through `SessionManager` exported by
`@earendil-works/pi-coding-agent` (a host-provided package), so the listing
follows the same session directory and cwd rules as the running pi, including
`--session-dir` overrides and named sessions.

## Development

```bash
mkdir -p node_modules/@earendil-works
ln -sfn "$(npm root -g)/@earendil-works/pi-coding-agent" node_modules/@earendil-works/pi-coding-agent
ln -sfn node_modules/@earendil-works/pi-coding-agent/node_modules/typebox node_modules/typebox
npx tsc -p tsconfig.json
```

For a local install while developing:

```bash
pi install /path/to/pi-sessions
```
