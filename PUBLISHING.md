# Publishing

Everything is built, typechecked, and packed. The registry step is currently
blocked by an npm account hold — see "Current blocker" below.

## State

| Item | Value |
| --- | --- |
| Package name | `pi-session-list` (unclaimed on npm as of 2026-10-20) |
| Version | `0.2.0` |
| Tarball | 10.7 kB packed / 31.1 kB unpacked / 4 files |
| Contents | `extensions/sessions.ts`, `package.json`, `README.md`, `LICENSE` |
| Typecheck | `npm run typecheck` clean |
| Registry entry | **not published** |

## Current blocker: 72-hour recovery-code hold

On 2026-10-20 we authenticated a publish with a **2FA recovery code** (one of
the 64-character codes in `.2fa`). npm accepts recovery codes for publishing,
but since 2026-09-09 it responds by putting the account into a **72-hour
read-only state**:

```
403 Your account has been temporarily suspended due to a recent security-sensitive action.
```

- Installs, `npm whoami`, and `npm stage list` still work.
- Publishing, staging, and token creation are paused.
- The hold lifts automatically; no support ticket is needed.
- Started: 2026-10-20 ~10:33 UTC → lifts ~2026-10-23 ~10:33 UTC.

**Do not use a recovery code to publish again.** Each use re-arms the hold.
Recovery codes are for account recovery, not routine publishing.

## Also relevant: the token is stage-only

The granular access token in `.env` has *Read and write (stage only)*
permission. It **cannot** run `npm publish` — direct publish fails with:

```
E_STAGE_REQUIRED: this token can only publish to a staging area
```

Staged publishing is the intended flow for that token, and it can create a
brand-new package (since 2026-10-02).

## Publishing after the hold lifts

### Option A — staged publish + approve (works with the current stage-only token)

Requires npm CLI >= 11.15 (`npx npm@latest` is enough).

```bash
npx npm@latest stage publish --access public
npx npm@latest stage list pi-session-list      # get the <stage-id>
npx npm@latest stage approve <stage-id>        # prompts for a TOTP code
```

The approve step is the proof-of-presence: enter the **6-digit code from the
authenticator app**, not a recovery code.

### Option B — trusted publishing from CI (no credentials at all, preferred long term)

1. On npmjs.com → package settings → **Trusted publishing** → add a GitHub
   Actions publisher for `armagg/pi-sessions`, workflow `publish.yml`,
   allowed actions `npm stage publish`.
2. `git tag v0.2.0 && git push --tags`

`.github/workflows/publish.yml` is already written for this: OIDC
(`id-token: write`), `npm stage publish`, then a manual approve.

### Option C — direct publish

Needs a token created as *Read and write (publish and stage)*. Direct publish
also prompts for a TOTP code, so it is not automatable without a bypass token
(npm is deprecating those).

## Credentials

Both files are gitignored, `chmod 600`, and outside the npm `files` whitelist:

- `.env` — the npm granular access token (stage-only)
- `.2fa` — 5 npm **recovery codes** (64-char hex, single use each)

Recovery codes are account-recovery material: anyone holding them can take over
the account. Keep them in a password manager rather than a project directory,
and delete these files from the repo checkout once publishing is done.

## After publishing

```bash
npm view pi-session-list
# gallery listing is automatic: https://pi.dev/packages/pi-session-list
pi install npm:pi-session-list
pi -e npm:pi-session-list        # try without installing
```

Then verify `/sessions`, `recent_sessions`, and `session_transcript` load.
