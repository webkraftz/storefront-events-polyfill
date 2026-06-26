# Releasing `@retenka/storefront-events-polyfill`

This package supports **two release paths**, in order of preference:

1. **[OIDC trusted publishing via GitHub Actions](#oidc-trusted-publishing-preferred)** — the standard, no tokens, signed provenance. Lives in [`.github/workflows/release.yml`](../.github/workflows/release.yml) and is driven by changesets.
2. **[Manual bootstrap publish from a developer machine](#manual-bootstrap-publish-fallback)** — short-lived granular token, no provenance. Use only when OIDC is broken.

The OIDC path is the long-term goal. The manual path exists for unblocking releases when something is wrong on the npm side.

---

## OIDC trusted publishing (preferred)

### How it works

1. PRs include a `.changeset/*.md` entry describing the version bump.
2. When the PR merges to `main`, the [`changesets/action@v1`](https://github.com/changesets/action) step in `.github/workflows/release.yml` opens (or updates) a "Version Packages" PR that bumps `package.json` and updates `CHANGELOG.md`.
3. When the **Version Packages PR is merged**, that same workflow runs `npm run release` (which calls `changeset publish`) and publishes to npm. The publish uses GitHub's OIDC token (no `NPM_TOKEN` secret needed) — `id-token: write` permission grants the token, and `npm publish --provenance` requests it.
4. npm verifies the OIDC token against its **trusted publisher** configuration for this package and signs a Sigstore provenance attestation.

### npm trusted publisher configuration

Lives at https://www.npmjs.com/package/@retenka/storefront-events-polyfill/access. Required values:

| Field                | Value                        |
| -------------------- | ---------------------------- |
| Publisher            | GitHub Actions               |
| Organization or user | `webkraftz`                  |
| Repository           | `storefront-events-polyfill` |
| Workflow filename    | `release.yml`                |
| Environment name     | _(leave blank)_              |
| Allowed actions      | ✅ Allow npm publish         |

### Verifying claims that GitHub sends

The release workflow includes a `Diagnostic — print OIDC claims for npm audience` step that prints the JWT payload (signature dropped, token never echoed). Compare against the npm UI configuration above. The claims SHOULD show:

```json
{
  "sub": "repo:webkraftz/storefront-events-polyfill:ref:refs/heads/main",
  "aud": "npm:registry.npmjs.org",
  "repository": "webkraftz/storefront-events-polyfill",
  "repository_owner": "webkraftz",
  "workflow_ref": "webkraftz/storefront-events-polyfill/.github/workflows/release.yml@refs/heads/main",
  "ref": "refs/heads/main",
  "environment": null
}
```

### Why the workflow calls `npm publish` directly (NOT `changeset publish`)

npm support flagged this in our 2026-06-25 ticket: tooling wrappers like
`changeset publish`, `lerna publish`, and `pnpm -r publish` can publish
via lower-level npm libraries rather than spawning the npm CLI binary,
which **bypasses npm's OIDC token-exchange flow** and surfaces as the
same 404 from the registry `PUT` endpoint. Sigstore signing still
succeeds (the GitHub OIDC token mints fine), but npm's registry-side
trusted-publisher exchange never gets called, so the upload is treated
as unauthorized.

The release workflow therefore overrides the changesets/action's
`publish` input to a direct `npm publish --access public --provenance
--loglevel verbose` invocation. The changesets/action still drives the
Version Packages PR flow (`package.json` + `CHANGELOG.md` updates) —
we just take over the publish step. `--loglevel verbose` is intentional
so the OIDC handshake lines are visible in CI logs when a future failure
needs the same diagnosis.

The workflow also pins `npm@11` before the publish step, because the
bundled npm version on some node 22 minor releases is 10.x with
documented OIDC quirks. Pinning explicitly removes that variable.

### Common failure modes

| Symptom                                                                                                                    | Cause                                                                                                                      | Fix                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm error 404 Not Found - PUT registry.npmjs.org/@retenka%2fstorefront-events-polyfill` AFTER successful Sigstore signing | npm's "not authorized" disguised as 404. Trusted-publisher row mismatch (typo, env name, case) OR stuck server-side cache. | (1) Verify each field in the npm UI matches the OIDC claims exactly. (2) If it does, **delete and re-add the trusted publisher row** to force a fresh server-side state. (3) If that still fails, use the [manual bootstrap publish](#manual-bootstrap-publish-fallback) and open an npm support ticket. |
| `npm error 409 Conflict — Failed to save packument`                                                                        | npm's packument doc is in a half-saved state from a previous attempt.                                                      | Transient — wait 60-120 seconds, retry.                                                                                                                                                                                                                                                                  |
| `prettier --check` fails in the CI gate                                                                                    | Changeset / package.json edits introduced formatting drift.                                                                | Run `npm run format` locally, commit, push. The CI gate is `npm run lint && format:check && typecheck && test && build && size`.                                                                                                                                                                         |
| Workflow runs but no publish attempt fires                                                                                 | Unconsumed changesets in `main` — the action is in "open Version PR" mode, not "publish" mode.                             | Merge the open Version Packages PR.                                                                                                                                                                                                                                                                      |

---

## Manual bootstrap publish (fallback)

Use this **only** when OIDC publishing is broken AND a release is urgent. It bypasses Sigstore provenance (the registry will accept the publish but won't carry an attestation), so use it sparingly.

### Step 1 — Generate a short-lived granular access token

Go to **https://www.npmjs.com/settings/[your-username]/tokens** → **Generate New Token** → **Granular Access Token**.

| Field                            | Value                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Token name                       | `bootstrap-publish-<version>` (e.g., `bootstrap-publish-1.0.1`)                                  |
| Description                      | One-line note about why this token exists                                                        |
| Expiration                       | **1 day** (cap at 7) — DO NOT use no-expiration                                                  |
| Allowed IP ranges                | leave blank                                                                                      |
| Packages and scopes              | **Select packages** → `@retenka/storefront-events-polyfill` only (do not select the whole scope) |
| Permissions on selected packages | **Read and write**                                                                               |
| Two-factor authentication        | ✅ **Bypass 2FA when publishing**                                                                |

Generate. Copy the token. **Never paste it into chat / commits / Slack — only into your local terminal.**

### Step 2 — Align local clone with remote

```bash
cd c:/Users/mehdi/Downloads/Retenka/storefront-events-polyfill
git checkout main
git pull --rebase
```

If your local `package.json` lists an older version than `main`, the publish will go up under the older number — `npm` doesn't read the latest commit, it reads `package.json` from your working directory.

### Step 3 — Build

```bash
npm run build
```

Confirm `dist/auto.js` + `dist/index.js` + their `.cjs` + `.d.ts` siblings were regenerated.

### Step 4 — Publish without provenance

The `publishConfig.provenance: true` in `package.json` will fail locally with `Automatic provenance generation not supported for provider: null` (provenance requires CI). Explicit override:

```bash
npm publish --access public --no-provenance
```

If `--no-provenance` is rejected by your npm version, temporarily edit `package.json`:

```diff
 "publishConfig": {
-  "access": "public",
-  "provenance": true
+  "access": "public"
 },
```

Then publish, then REVERT the diff (commit message: `chore: restore publishConfig.provenance` — leave `provenance: true` in for the next CI publish).

### Step 5 — Verify

Open https://www.npmjs.com/package/@retenka/storefront-events-polyfill in your browser. The Versions tab should show the new version.

### Step 6 — Revoke the token IMMEDIATELY

Back at **https://www.npmjs.com/settings/[your-username]/tokens** → find the token you generated in Step 1 → **Delete** / **Revoke**.

This is non-negotiable. A leaked granular token with publish + bypass-2fa permission on a public package is a supply-chain attack vector.

### Step 7 — Reconcile version numbers

If you published under a different number than what `main`'s `package.json` says (because your local clone was behind), there's now a drift between npm and remote main:

- **Option A — accept the drift.** Next CI publish from the Version Packages PR will try the next version up. Some npm versions may be "skipped" but this is harmless.
- **Option B — align local + remote.** `git push` any temporary edits (provenance toggle) you made. Bump `package.json` on remote main to match the next-needed version if you want strict sequential.

The CI publish flow handles drift gracefully — it just publishes whatever `package.json` says.

---

## Field history

| Date       | Reason for manual bootstrap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Outcome                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-22 | First publish — npm scope had no prior versions, so OIDC trusted publisher couldn't be configured until the package existed.                                                                                                                                                                                                                                                                                                                                                                                            | Bootstrap-published v1.0.0 with short-lived token. Token revoked. Then configured the trusted publisher.                                                                                                                                                                                                                                                                                                          |
| 2026-06-25 | OIDC trusted publisher consistently returns 404 ("not authorized" disguised) despite UI showing correct configuration. Sigstore signing succeeds; npm rejects the upload. Root cause not yet identified — likely a stale server-side state from the first failed OIDC attempt.                                                                                                                                                                                                                                          | Bootstrap-published v1.0.1 with short-lived token. Token revoked. Issue still under investigation.                                                                                                                                                                                                                                                                                                                |
| 2026-06-26 | **RESOLVED.** npm support replied to the ticket: `changeset publish` (and similar tooling wrappers like `lerna publish`, `pnpm -r publish`) can publish via lower-level libraries that bypass npm's OIDC token-exchange flow. Sigstore signing succeeds but npm's registry-side trusted-publisher exchange never gets called → 404 on the `PUT` endpoint. Fix: override the changesets/action's `publish` input to call `npm publish --access public --provenance` directly, bypassing the `changeset publish` wrapper. | **v1.0.2 published successfully via OIDC trusted publishing** (workflow run 28255155820). Log confirms: `No NPM_TOKEN found, but OIDC is available - using npm trusted publishing`. Pinned npm to v11 and added `--loglevel verbose` in the same change so future OIDC issues are diagnosable from CI logs without another support ticket round-trip. Manual bootstrap path is now reserved for true emergencies. |

When the OIDC root cause is found, append a fix entry here and STOP using the manual path.
