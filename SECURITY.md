# Security Policy

## Supported versions

Only the latest commit on `main`, which is what <https://singularity-coral.vercel.app> runs, receives fixes.

## Reporting a vulnerability

Please **do not** open a public issue. Report it privately through GitHub's [private vulnerability reporting](https://github.com/Aryabhatta-0/singularity/security/advisories/new) with steps to reproduce and the impact you expect. You should get a response within a week. Please don't test against other players' rooms or try to degrade the live game for others; a local `npm run host` is the same stack.

## Threat model

**Trust boundaries**

- **Game sessions.** The production database only accepts connections carrying a token signed by the web app (ES256, issuer `https://singularity-coral.vercel.app`, audience `singularity`). Anonymous and foreign-issuer connections are refused at connect time, including the SQL and reducer HTTP endpoints. The signing key is a server-only Vercel secret; the public half is served at `/.well-known/jwks.json`. Sessions are pseudonymous: anyone can get one by loading the site, so they identify a browser, not a person.
- **Session endpoint.** `/api/session` rejects cross-site requests and is rate limited per IP. A deployment with no signing key fails closed rather than falling back to anything weaker.
- **Owner-only operations.** Only the identity that published the database can change the trusted issuer (`configure_access`) or clear rooms (`reset_rooms`). Scheduled reducers reject client callers.
- **Rooms.** Players only see rows for their own room through server-side views. Room codes are 8 characters from a 32-symbol alphabet; anyone with a code can join that room, so treat invite links like a party invite, not a password. The server caps live rooms, throttles room hopping and limits the rate of inputs and snapshots per player.
- **Input validation.** Names and team names are length-limited and stripped of control, zero-width and bidi characters. Inputs and snapshots are shape- and bounds-checked (finite numbers, plausible positions, owned seats only).
- **Leaderboard.** Clients can't write it. The server files a run when it times a squad's finish, only for full squads or solo free-for-all runs, with per-course minimum times and a 15-minute ceiling, deduplicated per crew and capped at 10 per board. It is read through the web app (`/api/leaderboard`, CDN-cached), not directly.

**Known limitations** (by design, not vulnerabilities)

- Physics runs in a player's browser, which also declares when its squad crossed the finish. The server times the run, so times can't be forged below the per-course minimum, but a modified client could still finish a course it didn't actually complete. Reports of ways around the ranking rules are welcome.
- Self-hosting with `npm run host` binds SpacetimeDB (port 3000) and the app (3001) to all interfaces for LAN play. Use it on trusted networks only; don't expose those ports to the internet.

## Secrets

Never commit credentials. `.env*` (except `.env.example`) and `.singularity/` (the local dev signing key) are git-ignored. If a signing key leaks, generate a new one and replace `SINGULARITY_SESSION_PRIVATE_KEY` in Vercel; tokens signed with the old key stop verifying once SpacetimeDB refreshes its cached copy of the published keys, and expire within six hours regardless.
