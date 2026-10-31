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

**Status 2026-10-31 (5 days after publish): unchanged, and now diagnosed as a
corrupt npm search-index record specific to this package name. Not fixable from
this repo's metadata.** Install and the detail page work normally.

### The controlled comparison that settles it

`@zxh126/pi-redact-secrets` was published the **same day** with **near-identical
downloads** and indexes perfectly:

| | `@zxh126/pi-redact-secrets` | `pi-session-list` |
| --- | --- | --- |
| published | 2026-10-26 | 2026-10-26 |
| downloads 10-26..11-01 | 231 | 228 |
| staged publish (`0.0.0-stage` first) | yes | yes |
| registry doc top-level keys | identical | identical |
| exact-name search | **rank 1, score 733.6** | **absent from top 250** |
| `keywords:pi-package` window | present (from=4250, score 15.7) | **absent** |
| pi.dev gallery | **listed** | **not listed** |

This rules out, with evidence: download volume, recency, metadata, keywords,
staged publishing, and scoped-vs-unscoped.

### The fault, precisely

Two symptoms in one record:

1. **The name is not matchable.** Querying `text=pi-session-list` never returns
   `pi-session-list`. Querying `text=pi-session` returns 20+ packages scoring
   140-245 (`pi-sessions` 223.6, `pi-session-tools` 207.3, `pi-session-viewer`
   216.4, ...) but not this one, even though the literal string is its name.
2. **Every text match scores exactly 0** (`session_transcript` → rank 2 score 0,
   `recent_sessions` → rank 5 score 0). So the document *is* in the index for body
   text, but its name field and its quality/popularity/maintenance scores were
   never computed.

Score 0 sorts it last of 13,076 keyword matches, and the gallery cron can only
page `from<=5000` (npm wraps `from=5001` back to page 1 — verified). The reachable
window bottoms out at score 13.95, so a record at 0 can never enter it.

### Not systemic

1,874 packages published on/after 2026-10-20 are reachable in that window,
including several published on 2026-10-31 itself (`pi-fabric` 31.8,
`confluence-cli` 32.4, `@agimon-ai/*` 31.5). All sampled packages match their own
names at scores 1,379-1,902. npm indexing is healthy for new packages generally;
this single record is broken.

### Also ruled out

- Version bumps: 0.2.0 -> 0.2.1 did not reindex it.
- npm reserved/typosquat names: `pi-session-tool`, `pi-subagent`, `pi-web-accesss`
  return `versions=[]`, `dist-tags=null` (genuinely reserved). This package has
  three real versions, so it is not reserved — just unscored.
- `pi.image`/`pi.video`: affect card rendering only, and the card never renders
  because the record is unreachable.
- Downloads API aliases: `last-week`/`last-day` currently return a stale
  `2026-06-25..2026-07-01` window. Always use an explicit range, e.g.
  `/downloads/point/2026-10-26:2026-11-01/<pkg>`, or the numbers mislead.

### Gallery churn

The catalog is not monotonically growing: 5,365 (10-26) -> 5,811 (10-27) ->
5,404 (10-31), while the keyword population grew 12,823 -> 13,076. Packages enter
and leave as scores move, so a fixed score-0 record has no path in.

### Options, in order of leverage

1. **Publish a new version now** (e.g. 0.2.2). The previous reindex attempt
   (0.2.1) landed within ~24h of package creation, possibly before the initial
   index entry settled. A publish 5+ days out is a fresh reindex trigger. Cheap
   and legitimate; needs the usual browser 2FA approval.
2. **Ask npm to reindex the record.** npmjs.com/support with the tables above.
   This is the only path that repairs the actual fault.
3. **Republish under a fresh name** (e.g. scoped `@omid0390/pi-session-list`).
   A new name gets a new index record, and the 1,874-package evidence shows new
   records index correctly. Costs the current name; would need a deprecation
   pointer from `pi-session-list`.
4. **Report upstream** on earendil-works/pi#7885 / #6991 / #6873. The exact-name
   evidence here is sharper than what those threads contain.
5. **Accept name-based discovery.** `pi install npm:pi-session-list` works and
   https://pi.dev/packages/pi-session-list is live and linkable.

**Do not attempt to inflate download counts.** It is metric fraud, breaches npm's
terms, risks account and package flagging — and the controlled comparison above
shows downloads are not the binding constraint anyway (228 vs 231).

### Re-check commands

```bash
# does it match its own name? (healthy packages return rank 1)
curl -s "https://registry.npmjs.org/-/v1/search?text=pi-session-list&size=10" \
  | python3 -c 'import json,sys;print([o["package"]["name"] for o in json.load(sys.stdin)["objects"]][:3])'
# score (0 = unreachable)
curl -s "https://registry.npmjs.org/-/v1/search?text=session_transcript&size=10" \
  | python3 -c 'import json,sys;[print(o["package"]["name"],o["score"]["final"]) for o in json.load(sys.stdin)["objects"]]'
# in the gallery index?
curl -sL "https://pi.dev/packages?name=pi-session-list" | grep -o 'packages-count">[^<]*'
# downloads (explicit range; the relative aliases are stale)
curl -s "https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/pi-session-list"
```
