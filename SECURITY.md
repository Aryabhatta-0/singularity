# Security Policy

## Supported versions

We fix only the latest commit on `main`. This is the version that <https://singularity-coral.vercel.app> runs.

## How to report a vulnerability

**Do not** open a public issue. Use GitHub's [private vulnerability reporting](https://github.com/Aryabhatta-0/singularity/security/advisories/new). Give the steps that cause the problem and the effect that you expect. We try to reply in one week or less. Do not test against the rooms of other players. Do not try to make the live game worse for other players. A local `npm run host` has the same setup, so test on it.

## Threat model

**Trust boundaries**

- **Game sessions.** The production database accepts only connections that have a token from the web app. The token uses ES256, the issuer `https://singularity-coral.vercel.app` and the audience `singularity`. The database refuses anonymous connections and connections from other issuers. This includes the SQL and reducer HTTP endpoints. The signing key is a secret on the Vercel server. The public key is at `/.well-known/jwks.json`. Sessions do not identify a person. Any visitor to the site gets one. A session identifies a browser.
- **Session endpoint.** `/api/session` refuses requests from other sites. It limits the number of requests from each IP address. If a deployment has no signing key, it gives no sessions. It does not use a weaker method.
- **Owner-only operations.** Only the identity that published the database can change the trusted issuer (`configure_access`) or clear the rooms (`reset_rooms`). Scheduled reducers refuse calls from clients.
- **Rooms.** Players see only the data for their room, through server-side views. A room code has 8 characters from an alphabet of 32 symbols. All persons with a code can join that room. Thus, an invite link is like a party invitation, not a password. The server limits the number of live rooms. It limits how fast a player can change rooms. It also limits the rate of inputs and snapshots from each player.
- **Input validation.** Names and team names have a maximum length. The server removes control characters, zero-width characters and bidi characters from them. The server checks the shape and the limits of inputs and snapshots. Numbers must be finite, positions must be possible, and players can control only their own seats.
- **Best times (leaderboard).** Clients cannot write to it. The server adds a run when it records the finish of a team. It adds only full teams or solo free-for-all runs. Each course has a minimum time, and the maximum time is 15 minutes. The server keeps one entry for each team and a maximum of 10 entries on each board. Clients read the best times through the web app (`/api/leaderboard`, cached by the CDN), not directly.

**Known limits** (these are part of the design, and are not vulnerabilities)

- Physics runs in the browser of a player. That browser also tells the server when its team crosses the finish. The server records the time, so a player cannot make a time that is less than the course minimum. But a changed client can still finish a course that it did not complete. Tell us if you find a way around the ranking rules.
- When you self-host with `npm run host`, SpacetimeDB (port 3000) and the app (port 3001) listen on all network interfaces for LAN play. Use this only on networks that you trust. Do not open these ports to the internet.

## Secrets

Do not commit credentials. Git ignores `.env*` (but not `.env.example`) and `.singularity/` (the local signing key). If a signing key becomes public, make a new key. Then replace `SINGULARITY_SESSION_PRIVATE_KEY` in Vercel. Tokens from the old key stop working when SpacetimeDB refreshes its copy of the public keys. All tokens also expire after six hours.
