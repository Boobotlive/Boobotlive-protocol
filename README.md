# Boobot

**One assistant. One memory. Every model.**

[![Live site](https://img.shields.io/badge/site-boobot.live-181818)](https://boobot.live)
[![Chain](https://img.shields.io/badge/chain-Solana-181818)](https://boobot.live)

| | |
|---|---|
| Chain | Solana |
| Contract address | Pending |

## Overview

Boobot is an assistant that keeps what you share, recalls it when it counts, and lets you choose the model behind each reply. This repository holds the public site at [boobot.live](https://boobot.live), including a live view of the Solana market that works with or without a launched token.

## Features

- Live Solana market table and ticker, refreshed every minute and paused while the tab is hidden
- Contract address slot that stays inert until an address is stated
- Project register: every external fact is a single record that is either stated, absent or unconfirmed
- Light and dark themes, full reduced-motion support, 44px tap targets
- Build and gate scripts that check the output before it ships

## Links

| Channel | Address |
|---|---|
| Site | https://boobot.live |
| X | Pending |
| GitHub | Pending |

## Develop

```bash
npm install
npm run build     # writes dist/
npm run gates     # builds, then runs every gate and both register branches
npm run preview   # serves dist/ on http://localhost:4173
```

Deploy the contents of `dist/`.

## License

MIT. See [LICENSE](LICENSE).
