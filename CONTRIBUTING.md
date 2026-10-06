# Contributing to SINGULARITY

Thanks for wanting to help make five people sharing one body even more chaotic. Bug reports, levels, mechanics, polish and docs are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Be kind. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Setup

You need **Node 24** (see `.nvmrc`) and the [SpacetimeDB CLI](https://spacetimedb.com/install) 2.10.

```bash
git clone https://github.com/<you>/singularity.git
cd singularity
npm install                     # also installs server/ dependencies on first `npm run host`
npm run host                    # SpacetimeDB + game server + app, http://localhost:3001
```

Prefer separate terminals (and hot reload)?

```bash
npm install --prefix server
spacetime start                 # local SpacetimeDB on :3000
npm run db:local                # publish server/ as `singularity`, trusting http://127.0.0.1:3001
npm run dev                     # http://localhost:3001
```

No SpacetimeDB handy? Start a room anyway and pick **Practice offline**, or add `?offline=1` to any `/play/<code>` URL, for a single-tab room with no server.

## Making a change

1. Fork and create a branch from `main`.
2. Keep the change focused. Match the style of the code around it.
3. If you change the game server (`server/`), republish it (`npm run db:local`) and run `npm run bindings`. Commit the regenerated `src/module_bindings/`; never edit it by hand. Schema changes must be backwards compatible with existing data: production is published with `--delete-data=never`.
4. Add or update unit tests in `tests/` for logic changes, and register new test files in `tests/all.test.mjs`.
5. Run the checks:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run e2e:room        # when server/ changed (needs `spacetime start`; uses a throwaway database)
   npm run e2e:leaderboard
   ```

6. Open a pull request and fill in the template. CI runs typecheck (app and server module), lint, unit tests and a production build.

Never commit secrets: `.env*` files (other than `.env.example`) and `.singularity/` are git-ignored for a reason.

## Browser tests (optional)

The Playwright suites in `tests/browser/` are Python and use your installed Chrome:

```bash
python -m pip install -r tests/requirements-browser.txt
npm run host                    # in another terminal
npm run test:browser
```

## Commit messages

Short imperative subject (`Fix ghost jitter on reconnect`), with a body explaining *why* when it isn't obvious.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
