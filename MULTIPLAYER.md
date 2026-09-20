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

The Playwright configuration starts isolated Vite and Wrangler servers on fresh random ports. Wrangler uses explicit `--local` mode (remote bindings disabled) with a separate `.wrangler/qa-<port>` data directory, so automated games do not share your manual-development rooms. Durable Objects and rate limiters are simulated locally; tests do not use production anti-abuse quotas or deployed game storage. See [Cloudflare's development-mode binding support](https://developers.cloudflare.com/workers/local-development/bindings-per-env/). `npm run build:worker` performs a local Wrangler bundle without deploying anything.

Run just the online browser tests with `npx playwright test tests/e2e/online.spec.ts`. They cover two-player sync, turn/undo alerts, approval, denial, cancellation, refresh, redo preservation, and server rejection of unauthorized or stale operations. Notification delivery is simulated through the browser API instead of producing real OS toasts during tests.

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

## Turn alerts

The online game panel has independent **Flash screen**, **Chime**, and **System notification** checkboxes, remembered in local storage on each browser/site. Flash and chime default to enabled; system notifications default to disabled. **Test alerts** previews the enabled alerts.

A turn alert fires when a newer verified game snapshot passes play from the other side to your role. Loading or refreshing a page, making your own moves, and reconnecting to the same revision do not ring again. A reconnect that reveals a newly arrived turn does alert.

The viewport pulse lasts 500 milliseconds. The two-note chime is generated locally and requires a click or key press on the page after opening or refreshing it, as browsers may block audio until that interaction. Enabling system notifications asks for browser permission from the checkbox click; denied or unavailable notifications are explained beside the control. Notifications contain only the game name and which side has the turn, and clicking one focuses the game window.

These are page-based desktop notifications, tested through the browser API; keep the game tab open to receive them. Delivery while backgrounded depends on browser/OS tab suspension and notification settings. This does not add push notifications for a closed browser or a mobile service worker. No Worker redeployment is needed for the alert UI.

## Undo requests after a turn

**Request undo** asks the other player to reopen your latest completed turn. The recipient gets the same enabled flash/chime/system-notification alerts and a small non-modal **Approve undo / Deny undo** panel. The panel can be minimized while inspecting the board and public log. The requester can cancel a pending request.

While a request is pending, game-changing actions pause on both devices, but display controls, the board, and the log remain available for review. Approval rewinds to the last actionable position immediately before the requester ended their turn, undoing that final action and any subsequent opponent actions. The complete history/redo tail is retained. The requester can use the normal Undo controls to go back further within that turn or change their final action. Denial/cancellation leaves the game history unchanged. Requests and decisions survive refresh/reconnection; initial page loads do not repeat alerts.

Only the authenticated opposite role can grant or deny. All requests/decisions/cancellations use the same per-role and per-IP rate limits, serialized processing, expected revision/history hash, and idempotency checks as moves. The server chooses the rollback target from replayed history: clients cannot submit arbitrary cursors, state, text, or files. Clients also validate the request against the full history and check consecutive request/decision transitions for inconsistencies.

This feature requires **both** the updated Worker (`npm run deploy:worker`) and the updated static frontend. Deploy the Worker first, then the frontend, and refresh both players' tabs. Existing rooms and credentials remain valid; no new Cloudflare resources, secrets, or migrations are needed. A new frontend connected to an older Worker disables requests with an update-needed hint; old frontends need a refresh to display/answer requests.

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
