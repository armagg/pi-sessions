# Publishing

**Published.** `pi-session-list@0.2.0` is live on npm and listed at
https://pi.dev/packages/pi-session-list. This file records how it got there and
how to release the next version.

## State

| Item | Value |
| --- | --- |
| Package name | `pi-session-list` — live on npm |
| Version | `0.2.0` |
| Stage ID | `3d002da8-a3df-4491-ac2f-400985d4610e` |
| Stage status | approved & published 2026-10-25 08:36 UTC |
| Tarball | 10.7 kB packed / 31.1 kB unpacked / 4 files |
| Contents | `extensions/sessions.ts`, `package.json`, `README.md`, `LICENSE` |
| Typecheck | `npm run typecheck` clean |
| Live version | **`0.2.0`** — `dist-tags.latest` |

## The account's second factor is a security key (no authenticator app)

Account `omid0390` has 2FA enabled with a **WebAuthn security key / passkey**.
There is no TOTP authenticator app, so there is no 6-digit code to type. The
registry says so on every challenged request:

```
www-authenticate: OTP
npm-notice: Open https://www.npmjs.com/login/<uuid> to use your security key for authentication
```

Consequences:

- **The npm CLI cannot complete this challenge.** It only accepts typed digits
  (`--otp=<digits>`); a security key produces none. An interactive
  `npm publish` / `npm stage approve` dead-ends at `Enter OTP:` with nothing to
  type.
- **Recovery codes are the only CLI-compatible path — and each use costs a
  72-hour account hold.** On 2026-10-20 one was used and the account was frozen
  (`403 Your account has been temporarily suspended due to a recent
  security-sensitive action`) until 2026-10-23. Never use one to publish.
- **The browser can complete it.** npmjs.com speaks WebAuthn natively, so every
  2FA-gated step (approving a staged version, configuring a trusted publisher)
  works there with a Touch ID / security-key tap.

So: do 2FA in the browser, let CI do the publishing via OIDC.

## Also relevant: the token is stage-only

The granular access token in `.env` has *Read and write (stage only)*
permission. It **cannot** run `npm publish` — direct publish fails with:

```
E_STAGE_REQUIRED: this token can only publish to a staging area
```

Staged publishing is the intended flow for that token, and since 2026-10-02 it
can create a brand-new package.

## Step 1 — stage (done, no 2FA)

```bash
printf '//registry.npmjs.org/:_authToken=%s\n' "$(cat .env)" > /tmp/psl.npmrc
chmod 600 /tmp/psl.npmrc

npx npm@latest stage publish --access public --userconfig=/tmp/psl.npmrc
# → + pi-session-list@0.2.0 (staged with id 3d002da8-…)
```

`npm stage` needs npm >= 11.15; the system npm is 11.4.0, hence `npx npm@latest`.
Staging never asks for 2FA — that is the point of staged publishing. For a
package that does not exist yet, npm publishes a public `0.0.0-stage`
placeholder and withholds the real tarball until approval.

Check it:

```bash
npx npm@latest stage list pi-session-list --userconfig=/tmp/psl.npmrc
```

## Step 2 — approve in the browser (this is the 2FA step)

The CLI cannot do this on a security-key-only account. On npmjs.com:

1. Sign in as `omid0390`.
2. Open the **Staged Packages** tab (avatar menu, or the package page →
   Staged Packages).
3. Review `pi-session-list@0.2.0` and click **Approve**.
4. Complete the 2FA prompt with the security key / Touch ID.

The staged version then replaces the placeholder and goes live.

## Step 3 — verify

```bash
npm view pi-session-list version
pi install npm:pi-session-list
pi -e npm:pi-session-list        # try without installing
```

Then confirm `/sessions`, `recent_sessions`, and `session_transcript` load.
The gallery listing at https://pi.dev/packages/pi-session-list is automatic
(indexed from npm; requires `keywords: ["pi-package"]`, already set).

## Future releases — trusted publishing (no 2FA, no tokens)

Now that the package exists, configure OIDC once in the browser: package
settings → **Trusted publishing** → GitHub Actions publisher —
`armagg/pi-sessions`, workflow `publish.yml`, allowed actions
`npm stage publish`. After that, every `v*` tag publishes from CI with
provenance and no stored credential; `.github/workflows/publish.yml` is already
written for it.

This is the only path that *removes* the security-key challenge instead of
trying to answer it — which is why it is the long-term answer for this account.

Direct `npm publish` needs a TOTP code (or a bypass-2FA token, which npm is
deprecating) and is therefore not usable here from the CLI.

## Credentials

Both files are gitignored, `chmod 600`, and outside the npm `files` whitelist:

- `.env` — npm granular access token (stage-only)
- `.2fa` — 5 npm **recovery codes** (64-char hex, single use each; 1 spent)

Recovery codes are account-takeover material. Move them into a password manager
and delete these files from the checkout once publishing is done. Do not use
them for publishing — each use freezes the account for 72 hours.

## Known open item: pi.dev gallery catalog listing

**Status 2026-10-26: root cause identified. It is upstream, not a defect in this
package.** The package is fully installable and its detail page is live; only the
browsable catalog index is missing.

### Root cause chain (each step verified)

1. The pi.dev gallery is a cron over npm's search API:
   `GET https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=N&from=OFFSET`
2. **npm caps `from` at 5000.** Verified directly:

   | request | first result |
   | --- | --- |
   | `from=0` | `billion-context` |
   | `from=4999` | `xz-pi-build-ios-apps` |
   | `from=5000` | `pi-wizlight-status` |
   | `from=5001` | `billion-context` ← **wraps back to page 1** |
   | `from=6000` | `billion-context` |

   So at most ~5,250 packages are reachable per query.
3. **12,823** packages carry the `pi-package` keyword; the gallery lists **5,376**.
   Roughly 7,400 packages (58%) are unreachable by this mechanism.
4. Result order is npm's search score, which falls monotonically across the window
   (`from=0`: 25.9–45.5, `from=2500`: 18.0–18.4, `from=5000`: 14.4–14.8).
5. **This package's search score is `0`.** It is indexed correctly — the keyword is
   present, so the query `text=session_transcript` finds it — but with
   `score.final = 0` it sorts last of 12,823, i.e. position ~12.8k, far outside the
   `from<=5000` window. Scanning all 21 reachable pages confirms it is absent.
6. Score `0` correlates with **zero downloads**. `api.npmjs.org/downloads` returns
   `{"error":"package pi-session-list not found"}` for every date range, while
   control packages with 3–153 weekly downloads all score 700–930 and are listed.
   The lowest-download packages in the gallery still have ~153/month.

### What this is not

- Not a metadata problem: `keywords` includes `pi-package`; `author`, `homepage`,
  `bugs`, `license`, and the `pi` manifest are all present and correct.
- Not fixable by a version bump: 0.2.0 → 0.2.1 did not change indexing.
- Not specific to this package: it is a long-standing, widely reported upstream
  issue — earendil-works/pi#7885 (*"npm search not indexing newly published
  pi-packages"*, closed NOT_PLANNED), #6991, #6873. The maintainer's stated
  conclusion is that npm search no longer returns reliable results and the only
  robust fix would be pi maintaining its own npm mirror, which does not exist.

### Options

1. **Drive real installs.** Downloads appear to be the score input. A handful of
   genuine installs is enough to clear the ~14.4 cutoff (control packages with
   8/week score ~777). Stats aggregate daily and lag, so allow ~1–2 days, then
   re-check. This is the only lever with evidence behind it.
2. **Wait.** Packages with a non-zero score drift in and out of the window over
   days; one reporter saw a package appear and later disappear. Not reliable.
3. **Accept it and rely on direct discovery.** `pi install npm:pi-session-list`
   works, and https://pi.dev/packages/pi-session-list is live and linkable. This is
   what the affected packages in #7885/#6991 settled for.
4. **Add a data point upstream** on earendil-works/pi#7885 so the mirror fix gets
   prioritised.

### Re-check commands

```bash
# in the gallery index?
curl -sL "https://pi.dev/packages?name=pi-session-list" | grep -o 'packages-count">[^<]*'
# search score (0 = unreachable)
curl -s "https://registry.npmjs.org/-/v1/search?text=session_transcript&size=10" \
  | python3 -c 'import json,sys;[print(o["package"]["name"],o["score"]["final"]) for o in json.load(sys.stdin)["objects"]]'
# downloads (a number instead of "not found" = registrations exist)
curl -s "https://api.npmjs.org/downloads/point/last-week/pi-session-list"
```
