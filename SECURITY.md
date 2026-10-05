# Security Policy

## Supported versions

Only the latest commit on `main` receives fixes.

## Reporting a vulnerability

Please **do not** open a public issue. Report it privately through GitHub's [private vulnerability reporting](https://github.com/Aryabhatta-0/singularity/security/advisories/new) with steps to reproduce and the impact you expect. You should get a response within a week.

## Threat model, briefly

- `npm run host` runs SpacetimeDB and the game on **all network interfaces** (ports 3000 and 3001). It is meant for trusted networks such as your home LAN or a private VPN. Don't expose those ports to the public internet.
- The room server database is wiped every time someone starts hosting; it holds no long-lived data.
- The leaderboard module is the only piece designed to be hosted publicly. It checks the shape and bounds of each submitted run (known challenge, squad size, plausible time, name lengths) and keeps a bounded top 10 per board. Run times are reported by the team host's browser and are **not** independently verified, so a modified client can submit fake times; this is a known limitation, not a vulnerability. Reports of ways to crash, flood or corrupt the leaderboard beyond that are welcome.
