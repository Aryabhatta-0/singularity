# Contributing to SINGULARITY

Thank you for your help. We welcome bug reports, new levels, new mechanics, better visuals and better docs.

## Before you start

- For a change that is larger than a small fix, open an issue first. Then we can agree on the method.
- Be kind. This project uses the [Code of Conduct](CODE_OF_CONDUCT.md).
- Do not report security problems in public issues. Use the steps in [SECURITY.md](SECURITY.md).

## Setup

You must have **Node 24** (see `.nvmrc`) and the [SpacetimeDB CLI](https://spacetimedb.com/install) 2.10.

```bash
git clone https://github.com/<you>/singularity.git
cd singularity
npm install                     # the first `npm run host` also installs the server/ dependencies
npm run host                    # SpacetimeDB + game server + app, http://localhost:3001
```

To use separate terminals (and hot reload), do these commands:

```bash
npm install --prefix server
spacetime start                 # local SpacetimeDB on :3000
npm run db:local                # publishes server/ as `singularity`, which trusts http://127.0.0.1:3001
npm run dev                     # http://localhost:3001
```

If you do not have SpacetimeDB, you can still play. Start a room and select **Practice offline**. Or add `?offline=1` to a `/play/<code>` URL. This gives a room in one tab without a server.

## How to make a change

1. Fork the repository. Make a branch from `main`.
2. Keep the change small and on one subject. Use the same style as the code near it.
3. If you change the game server (`server/`), publish it again (`npm run db:local`). Then do `npm run bindings`. Commit the new `src/module_bindings/`. Do not edit these files by hand. Schema changes must work with the existing data, because production uses `--delete-data=never`.
4. If you change logic, add or update unit tests in `tests/`. Add new test files to `tests/all.test.mjs`.
5. Do the checks:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run e2e:room        # if you changed server/ (needs `spacetime start`; uses a temporary database)
   npm run e2e:leaderboard
   ```

6. Open a pull request and complete the template. CI does a typecheck (app and server module), lint, unit tests and a production build.

Do not commit secrets. Git ignores `.env*` files (but not `.env.example`) and `.singularity/` for this reason.

## Browser tests (optional)

The Playwright tests in `tests/browser/` use Python and your installed Chrome:

```bash
python -m pip install -r tests/requirements-browser.txt
npm run host                    # in a different terminal
npm run test:browser
```

## Commit messages

Write a short subject in the imperative, for example `Fix ghost jitter on reconnect`. If the reason for the change is not clear, give the reason in the body.

## License

When you contribute, you agree that your contributions use the [MIT License](LICENSE).
