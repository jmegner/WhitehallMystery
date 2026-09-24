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

`npm run test:e2e` runs the departure/replacement scenarios in a second isolated local Worker invocation so the suites do not compete for the same simulated per-IP connection quota. Run those alone with `npx playwright test tests/e2e/onlineDepartures.spec.ts`. No production limiter is disabled or increased for testing.

## Cloudflare configuration

`worker/wrangler.jsonc` declares:

- the `GameRoom` Durable Object and its SQLite storage;
- a five-per-minute-per-IP game-creation limiter;
- a thirty-per-minute-per-IP WebSocket-connection limiter;
- a 120-per-minute-per-IP status/membership-request limiter;
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

## Multiple saved games and starting-location privacy

**Resume game**, beside **New game**, lists this browser/site's same-device, By Mail, and online games by local start time, mode, round, move, and whose turn. New games no longer discard existing ones. Switching and refreshing retain each local/mail game's full undo/redo history, and each By Mail game's draft and board/sharing view. Online credentials are saved separately for each room and role; resuming reconnects to the authoritative full history in its Durable Object.

Only the open online game has a live connection and receives turn/undo/departure alerts. Inactive online entries are explicitly marked **last known**. The resume screen checks their status on opening, every 30 seconds while open, and through **Refresh status**, using authenticated read-only HTTP requests that do not take over an existing game socket. The list and credentials are browser-local, not an account or cross-device game library; clearing site storage removes them. GitHub Pages and Cloudflare Pages each have separate storage. Expired server rooms cannot be revived by a local entry.

Existing single-game saves are imported automatically, leaving the original stored copies untouched. Older same-device saves have no recorded start date and are labeled **Start time unknown**. Storage failures are shown instead of silently claiming a save succeeded; damaged entries are preserved rather than overwritten or deleted.

The investigator's online board and public log do not reveal Jack's tentative starting location until he records his first move, including after changes, undo, or refresh. Investigator actions still appear live for Jack. This is a UI privacy boundary, consistent with the existing trust model: both authenticated players still receive the full verified history, not a cryptographically redacted view.

For accurate online start times (including existing rooms), deploy the updated Worker with `npm run deploy:worker`, then publish the frontend. The Worker adds its already-stored room creation time to authenticated snapshots and successful creation responses. No new secrets, bindings, migrations, or Cloudflare dashboard setup are needed. Older Workers remain compatible but cannot supply missing start times; authentication, IP/role rate limits, and restrictions on writable commands are unchanged.

## Leaving games and inviting replacements

Every saved-game row has a **Leave** button with confirmation. Same-device and By Mail entries are removed from this browser, including their saved history and mail draft. Tiny credential-free tombstones prevent legacy-save migration from resurrecting removed entries. Leaving the last game keeps an empty list rather than creating another game automatically.

**Leave+New Game** in the active game's navigation uses the same confirmed departure, then opens the new-game chooser for selecting a mode and side. Ordinary **New game** still retains the previous game. A failed online departure keeps the current entry and does not proceed to creation; retrying reuses the departure request ID.

Online Leave first asks the backend to mark the authenticated side as departed. Only after acknowledgement is the local entry removed; network/server failures keep it for retry. Retries are idempotent. Expired rooms and already-revoked credentials can be removed locally. Ordinary disconnects, closing a tab, or switching games never count as leaving.

The Worker preserves the entire game/redo history, cancels any pending undo request, revokes the departed role's credential, and disconnects its sockets. The opponent sees a notice and receives their enabled flash/chime/notification alert while viewing the game; the resume list also displays **Opponent left the game**. An old acknowledged Leave can never evict a replacement player.

The remaining authenticated player can choose **Create replacement invitation** for either role, including Jack. This issues a new credential for that role; older links for it no longer work. **Replace invitation link** invalidates the previous replacement link. Copying an existing link does not rotate it. Invitation retries reproduce the same credential without storing plaintext tokens on the server, and tokens are bound to the room, requester, request ID, and seat generation.

Connecting with an invitation or making a partial move does not clear the departed flag. It clears when that side completes a turn through accepted game commands (including setup turns); the other side's moves or undo decisions do not clear it. Updates propagate to the opponent and saved-game summaries. Undo requests are unavailable while a departed flag remains.

This feature requires deploying the updated Worker **before** the frontend with `npm run deploy:worker`. The checked-in config automatically adds the `SESSION_LIMITER` binding; no dashboard work, secrets, Turnstile, or data migration is needed. Older rooms default to neither side having left. Older Workers cannot process Leave or refresh membership status, and the UI keeps the entry with an update-needed error.

## Authentication and stored data

Room creation generates independent random 256-bit credentials for Jack and the investigator side. The creator can choose either role, retaining an invitation for the opposite role. The Durable Object stores only SHA-256 credential hashes. The invited side's credential is carried in the invitation URL fragment, which is not sent in the page's HTTP request, and is then saved locally on that player's device.

The room ID alone grants no access. A socket receives no state until its first message proves one of the role credentials. Authentication failures return the same response for nonexistent, expired, and unauthorized games.

Each persisted revision contains:

- every accepted game action, including the redo tail;
- the undo/redo cursor and pending reveal state;
- the complete current `GameState`;
- a rules version, revision, and SHA-256 history hash.

Both the Worker and browser replay every action and require the replayed state and hash to match the supplied current state. Clients submit only typed game commands with the expected revision and history hash; they cannot replace server state.

## Abuse controls

The public API has health, room creation, WebSocket upgrade, and a tightly scoped authenticated session endpoint for status, Leave, replacement invitations, and renaming. There is no generic write, chat, upload, or key/value endpoint. Creation accepts either an empty body or a JSON object containing only an optional game name, within 512 UTF-8 bytes. Session bodies are limited to 768 UTF-8 bytes (including streamed bodies), reject unknown fields, and cannot choose a target role or write game state. Renames accept only a bounded name, expected previous name, credential, and request ID. The credential determines the role; only a departed opposing seat can be replaced. Mutations are serialized with game commands and use the same per-role/per-IP command limits, alongside the edge session-request limit.

The Worker and Durable Object enforce:

- Cloudflare edge limits keyed by `CF-Connecting-IP` before room creation or connection;
- exact per-role and hashed-per-IP command limits inside each room;
- strict message shapes, small messages, bounded command batches, bounded histories, and expiring rooms;
- current-role, current-turn, revision, and history-hash checks;
- server-side reducer execution and invariant-producing replay;
- idempotent request IDs and one active socket per role.

Cloudflare's edge rate counters are intentionally permissive and local to a Cloudflare location, so game correctness does not depend on them. Durable Object limits and protocol validation remain authoritative.

## Game names and either-side creation

Online creation offers **Start new game as Jack** and **Start new game as Investigators**, plus an optional game name. The name draft is remembered locally. Both roles can send the generated private invitation to the other side; investigators wait for Jack to choose the discovery locations as usual.

**Edit name** in each Resume game entry can add, change, or clear its name. Online names are shared room metadata: either authenticated player can rename, and the other player's open game updates live. Same-device and By Mail names are browser-local labels, not part of mail messages. Names appear alongside (not instead of) the start time, mode, and progress.

Names are limited to 80 UTF-16 code units, trimmed, single-line, and exclude control and bidirectional override characters. They are rendered as text. The room stores only its current name, not an arbitrary metadata object or name history. Names necessarily allow a small amount of free text; strict size limits, authentication, existing IP/role quotas, and room expiry still apply. No Turnstile is added.

Renaming verifies the expected previous name to avoid silently overwriting a concurrent edit, supports idempotent retries, increments the room revision, and preserves the full game/undo history and its hash. Resolve a pending undo request before renaming. Existing rooms default to an empty name; old clients can still use them.

Deploy the updated Worker with `npm run deploy:worker` before publishing the frontend. This addition needs no new bindings, secrets, dashboard steps, or storage migration.
