# Contributing

Thanks for considering a contribution. The project is intentionally small and focused — see [ARCHITECTURE.md](./ARCHITECTURE.md) for the rationale on scope.

## Dev setup

```bash
git clone https://github.com/webkraftz/storefront-events-polyfill
cd storefront-events-polyfill
nvm use   # uses Node 22 per .nvmrc; any Node >=20 works
npm install
```

## Workflow

```bash
npm run dev          # tsup watch mode (rebuilds dist/ on change)
npm run test:watch   # vitest watch mode
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format       # prettier --write
npm run build        # tsup → dist/
npm run size         # size-limit gate
npm run ci           # full local CI: lint + typecheck + test + build + size
```

## Standards

- **TypeScript strict mode.** No `any`. No `@ts-ignore`. Exceptions documented inline.
- **Lint clean.** ESLint + Prettier. PR's must pass `npm run lint` and `npm run format:check`.
- **Tests are mandatory** for behavior changes. We target >90% coverage on `src/` (configured in `vitest.config.ts`).
- **Bundle size budget**: 3 KB gzipped for `dist/index.js`. Enforced in CI by `size-limit`.
- **Browser targets**: ES2022, last 2 evergreen versions of Chrome / Firefox / Safari / Edge. No IE.

## PR checklist

Before opening a PR:

- [ ] `npm run ci` passes locally
- [ ] Tests cover the new behavior (or explain why not)
- [ ] You've run `npm run changeset` and committed the resulting `.changeset/*.md` file alongside your code

### Writing a changeset

```bash
npm run changeset
```

The CLI prompts you to:

1. Pick a bump type: `patch` (bug fix), `minor` (new feature, backward compatible), `major` (breaking change)
2. Write a one-line summary that goes into the changelog

The changeset file is committed alongside your code changes. On merge to `main`, the release workflow opens a "Version Packages" PR that aggregates pending changesets, bumps the version, writes `CHANGELOG.md`. When that PR is merged, npm publish runs.

## Releasing

The release flow is fully automated via the [release workflow](../.github/workflows/release.yml):

1. Contributors include changesets in their PRs (see above)
2. Merging to `main` triggers the changesets bot to open/update a "Version Packages" PR
3. Reviewing + merging the Version Packages PR triggers npm publish via OIDC trusted publishing

There is NO manual `npm publish` step. The workflow uses `id-token: write` + `npm publish --provenance` — no PAT or NPM_TOKEN is stored as a secret.

### Setting up OIDC trusted publishing (one-time, scope owner)

1. Visit https://www.npmjs.com/settings/retenka/trusted-publishers (or your scope's URL)
2. Click "Add trusted publisher"
3. Fill in:
   - Publisher: GitHub Actions
   - Repository: `webkraftz/storefront-events-polyfill`
   - Workflow filename: `release.yml`
   - Environment name: (leave blank unless you set one up)
4. Save

Once configured, `npm publish` from the release workflow authenticates via the OIDC token automatically.

## Reporting issues

- Bugs / unexpected behavior: open an issue with reproduction steps. Include browser + theme + Shopify shop URL if possible.
- Feature requests: open an issue tagged `enhancement`. Keep in mind the project's intentional scope — we polyfill cart events because they're polyfillable via network interception. We don't polyfill product-view / search / collection events, those are theme-dispatched only.
- Security: do not open a public issue. Email `security@retenka.com`.
