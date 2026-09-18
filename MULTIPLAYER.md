# Online multiplayer

Online multiplayer keeps the existing GitHub Pages and Cloudflare Pages sites static. A separate Cloudflare Worker routes each game to one SQLite-backed Durable Object and maintains a hibernating WebSocket for each player.

## Local development

No secrets are needed. Start the Worker and web app in separate terminals:

```text
npm run dev:worker
npm run dev
```

Development builds default to `http://127.0.0.1:8787` for the Worker. To use another address, copy `.env.example` to `.env.local` and set `VITE_MULTIPLAYER_API`. That URL is public configuration, not a credential.

Run all checks with:

```text
npm run lint
npm run build
npm run test
```

The Playwright configuration starts isolated Vite and Wrangler servers on fresh random ports. `npm run build:worker` performs a local Wrangler bundle without deploying anything.

## Cloudflare configuration

`worker/wrangler.jsonc` declares:

- the `GameRoom` Durable Object and its SQLite storage;
- a five-per-minute-per-IP game-creation limiter;
- a thirty-per-minute-per-IP WebSocket-connection limiter;
- the room lifetime;
- allowed browser origins.

The exact production origins for GitHub Pages and `https://whitehallmystery.pages.dev` are listed in `ALLOWED_ORIGINS`. Rate-limiter namespace IDs and allowed origins are not secrets.

The eventual deployment sequence is:

1. Run `npx wrangler login` and approve the browser sign-in.
2. Run `npm run deploy:worker`. The first deployment provisions the Durable Object namespace.
3. Put the resulting Worker URL in the Cloudflare Pages `VITE_MULTIPLAYER_API` build variable and the GitHub repository variable with the same name.
4. Rebuild the static sites.

A custom Worker domain is optional. No Turnstile setup or application secret is used. CI deployment would require a Cloudflare API token in the CI secret store, never in this repository.

## Authentication and stored data

Room creation generates independent random 256-bit credentials for Jack and the investigator side. The Durable Object stores only SHA-256 credential hashes. The investigator credential is carried in the invitation URL fragment, which is not sent in the page's HTTP request, and is then saved locally on that player's device.

The room ID alone grants no access. A socket receives no state until its first message proves one of the role credentials. Authentication failures return the same response for nonexistent, expired, and unauthorized games.

Each persisted revision contains:

- every accepted game action, including the redo tail;
- the undo/redo cursor and pending reveal state;
- the complete current `GameState`;
- a rules version, revision, and SHA-256 history hash.

Both the Worker and browser replay every action and require the replayed state and hash to match the supplied current state. Clients submit only typed game commands with the expected revision and history hash; they cannot replace server state.

## Abuse controls

The public API has only health, empty-body room creation, and WebSocket upgrade routes. There is no generic write, chat, upload, or key/value endpoint.

The Worker and Durable Object enforce:

- Cloudflare edge limits keyed by `CF-Connecting-IP` before room creation or connection;
- exact per-role and hashed-per-IP command limits inside each room;
- strict message shapes, small messages, bounded command batches, bounded histories, and expiring rooms;
- current-role, current-turn, revision, and history-hash checks;
- server-side reducer execution and invariant-producing replay;
- idempotent request IDs and one active socket per role.

Cloudflare's edge rate counters are intentionally permissive and local to a Cloudflare location, so game correctness does not depend on them. Durable Object limits and protocol validation remain authoritative.
