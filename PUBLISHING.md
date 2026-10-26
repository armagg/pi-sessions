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

The package page (https://pi.dev/packages/pi-session-list) works, but the package
is **not in the browsable catalog** (https://pi.dev/packages). Checked
2026-10-26, ~28h after publish:

| Check | Result |
| --- | --- |
| `https://pi.dev/packages/pi-session-list` | 200, correct metadata |
| `https://pi.dev/packages?name=pi-session-list` | `0 / 5365` — not in the index |
| npm search `text=pi-session-list` | absent (exact-name query, 250 results) |
| `npm install pi-session-list@0.2.1` | works |

Cause: the gallery catalog is built from npm's **search** index, and this package
is not in it. That is an npm-side indexing lag, not a package defect — metadata
is complete (`keywords` includes `pi-package`, plus `author`, `homepage`,
`bugs`, `license`, `pi` manifest).

Evidence it is npm-side: a control query on a package created 0.0h ago is also
absent from npm search, and among packages aged 24-30h some are indexed and some
are not. There is no documented way to force it. `pi.image` / `pi.video` affect
the card rendering only, not inclusion.

Re-check after a few days:

```bash
curl -sL "https://pi.dev/packages?name=pi-session-list" | grep -o 'packages-count">[^<]*'
curl -s "https://registry.npmjs.org/-/v1/search?text=pi-session-list&size=250" \
  | python3 -c 'import json,sys;print("pi-session-list" in [o["package"]["name"] for o in json.load(sys.stdin)["objects"]])'
```

If it is still absent after ~a week, the fallback is discovery by name: install
instructions work, and the detail page is live and linkable.
