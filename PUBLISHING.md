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

**Status 2026-10-27: root cause narrowed to a broken npm search-index entry.
Upstream, not a defect in this package.** Install and the detail page work;
only catalog discovery is missing.

### The decisive evidence

A healthy npm package ranks #1 for its own exact name. This one does not:

| `text=` query | `pi-session-list` result | control `pi-session-tools` |
| --- | --- | --- |
| exact package name | **absent from top 250** | rank 1 |
| `session_transcript` | present, **score 0** | — |
| `recent_sessions` | present, **score 0** | — |

Two separate faults in the same record:

1. The **name is not matchable** — searching `pi-session-list` never returns
   `pi-session-list`, so it cannot surface by name at all.
2. Every text match scores **`score.final = 0`**, so it sorts last of 12,823
   keyword matches and never enters the `keywords:pi-package` feed the gallery
   cron pages through.

### The gallery mechanism (and why the window matters)

The pi.dev gallery cron reads:

```
GET /-/v1/search?text=keywords:pi-package&size=N&from=OFFSET
```

npm **caps `from` at 5000** — `from=5001` wraps back to page 1 (verified). So a
single query reaches ~5,250 records. 12,823 packages carry the keyword and the
gallery lists 5,811; the balance is only visible historically, and reachable
ordering is opaque (every package reports `popularity/quality/maintenance = 1`,
capped, so score differences come from npm-internal weighting).

### Correction: downloads are NOT the lever

An earlier revision of this file claimed score tracked download volume. That is
**wrong** and was disproved on 2026-10-27:

- This package now has **386 downloads** in the window `2026-10-19..2026-10-26`
  and `score.final` is **still 0**.
- `pi-cmem` has 22 downloads and scores 777; `pi-session-tools` has 23 and
  scores 838. Download volume does not explain the score.

Note the downloads API's relative aliases (`last-week`, `last-day`) currently
return a stale `2026-06-25..2026-07-01` window; use an explicit range
(`/downloads/point/2026-10-19:2026-10-26/<pkg>`) or the numbers are misleading.

### Not a metadata problem

`keywords` contains `pi-package`; `author`, `homepage`, `bugs`, `license`, and the
`pi` manifest are present and correct. A version bump (0.2.0 → 0.2.1) did not
reindex it. `pi.image`/`pi.video` affect card rendering only.

### Matching upstream reports

Multi-month, multi-author, unresolved: earendil-works/pi#7885 (*"npm search not
indexing newly published pi-packages"*, closed NOT_PLANNED), #6991, #6873.
Reporters describe exactly this signature — correct metadata, installable,
`npm view` works, absent from search, version bumps do not help. The maintainer's
position is that npm search is no longer reliable and a proper fix means pi
running its own npm mirror.

### Options that remain

1. **Ask npm to reindex.** The index record itself is broken, so this is the only
   path that fixes the actual fault: npmjs.com/support, including the evidence
   table above (exact-name miss + score 0).
2. **Add the data point upstream** on earendil-works/pi#7885 or a fresh issue.
3. **Accept direct-name discovery.** `pi install npm:pi-session-list` works and
   https://pi.dev/packages/pi-session-list is live and linkable. This is where the
   other affected authors landed.
4. **Publish under a new name** whose index entry is healthy (e.g. a scoped
   `@omid0390/pi-session-list`), trading the current name for discoverability.
   Untested; a new package name starts a fresh index record.

**Do not attempt to inflate download counts.** It is metric fraud, breaches npm's
terms, risks account and package flagging, and on the evidence above it would not
change the score anyway.

### Re-check commands

```bash
# does it match its own name (healthy packages return rank 1)?
curl -s "https://registry.npmjs.org/-/v1/search?text=pi-session-list&size=10" \
  | python3 -c 'import json,sys;print([o["package"]["name"] for o in json.load(sys.stdin)["objects"]][:3])'
# score (0 = unreachable)
curl -s "https://registry.npmjs.org/-/v1/search?text=session_transcript&size=10" \
  | python3 -c 'import json,sys;[print(o["package"]["name"],o["score"]["final"]) for o in json.load(sys.stdin)["objects"]]'
# in the gallery index?
curl -sL "https://pi.dev/packages?name=pi-session-list" | grep -o 'packages-count">[^<]*'
# downloads (explicit range; aliases are stale)
curl -s "https://api.npmjs.org/downloads/point/2026-10-19:2026-10-26/pi-session-list"
```
