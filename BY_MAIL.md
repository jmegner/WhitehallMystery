# By Mail (wire format v2, with v1 read compatibility)

Choose **New game → By Mail**. Jack creates the game and chooses four discovery
locations, then sends the invitation to the investigator player. Subsequent
messages are addressed to the opposite side. A recipient can join using the
text or a link, including on a replacement device. On an existing device, load
replies in the waiting panel. Messages are cumulative; keep the latest one. Text starts with the two-digit
completed turn number and a hyphen: `01-…`, `02-…`, and so on. The prefix is
required and checked against the replayed history. Unprefixed text and links
are rejected; there is no legacy fallback or automatic conversion.
During play, the heading shows `Turn N in progress` for the current turn.
After completion it shows `Turn N, MMMDD HH:MM:SS zone`, using the time that turn
finished in the browser's local time zone, including daylight saving and local
date changes. The stored finish timestamp remains Unix seconds. When sharing during a turn, the previous completed turn and its
finish time are labeled separately alongside the outgoing text. Discovery setup is turn 1, investigator setup turn 2, Jack's first
move turn 3, and so on. The game start time is displayed in the browser's local time zone with a zone
label; its stored game ID remains Unix seconds. The turn finish time travels with the message and survives
refreshes and rejoining; restoring an identical turn with Redo preserves its
time, while a revised turn receives a new finish time. Old v1 messages show
`time unavailable` until a new turn finishes.

The app persists the local action sequence, including unfinished turns, in
local storage. Only completed turns become shareable. Undo and Redo operate within the local player's latest turn, including reopening
a completed turn before a reply is loaded. Undo Side restarts that local turn;
Redo Side restores its remaining recorded actions and stops at the opponent's turn.
Rand, Rand Side, the Actions counter,
and investigator automation are available. Redo history survives refreshes.
Investigator peek remains unavailable. Show board / Show sharing
switches between the player's own board view and the message controls; that
preference is saved. Board actions and random play are disabled while waiting,
and loading a reply establishes a new undo boundary. The sharing panel also
provides Undo and Undo side (restart the local turn). No game server is used.

## Corrections

Sharing remains available during an unfinished turn. It offers the latest
completed game text; normal reply loading is disabled during your turn.
Load partner's correction is always available in that panel.

Corrections are replayed and validated, then compared against the last received
opponent text, excluding local work based on it. Replacing or removing only
the opponent's most recent turn is accepted directly and discards dependent
local work, including its redo history. Earlier changes, additional turns, or
a different game ID show a review with changed turn numbers, old/new last turn
numbers, game ID comparison, and the effect on local work. Accept replaces the
local game; Reject leaves it untouched. Invalid data and messages addressed to
the wrong side cannot be accepted. Join existing game remains a separate flow.

Links preserve the current deployment path and put the message in `#mail=…`.
This works at both the Cloudflare root and GitHub Pages' `/WhitehallMystery/`
path. Fragments are not sent to the hosting server. Copy and Web Share controls
support both raw text and links, with a selectable text fallback.

## Binary envelope

- 4 bytes: unsigned big-endian Unix creation time in seconds (also the game ID).
- 1 byte: version and recipient: `(2 << 1) | recipient`, Jack = 0, investigators = 1.
- 4 bytes: unsigned big-endian Unix finish time of the latest completed turn.
- Variable bytes: complete chronological move transcript described below.
- 4 bytes: CRC-32/ISO-HDLC over the clear ID, header, finish time, and transcript.

All bytes after the ID are XORed with successive low bytes of xorshift32, seeded
with `id ^ 0x9e3779b9`, with shifts 13 left, 17 unsigned right, 5 left.
The resulting bytes are encoded as unpadded Base64URL. Decoding checks the
checksum, version, canonical encoding, legal game actions, and turn boundary.
Replies also check recipient, ID, and the existing transcript prefix. When a
reply adds more than one player turn, the app loads it and displays a notice
with the number of added turns, including turns for the receiving side. Joining
an existing game does not display this notice. Keep the
fixed crossing dictionary and replay rules compatible with v1 and v2; a rules or map
change that alters replay must introduce a new version.

This is obfuscation for casual play, not encryption or authentication. Both
clients need the private state to resolve searches offline. A determined player
can recover it using developer tools or write altered messages with a valid
checksum. The UI never offers investigators Jack's private view during play.
As requested, the timestamp has one-second granularity: games created in the
same second share an ID; conflicting histories are checked separately.

## Transcript

Stages and search results are reconstructed by the game engine, so no turn
numbers, search outcomes, handoff markers, or round-reset records are needed.

| Event | Bytes |
| --- | --- |
| Jack's discovery setup | 4 circle IDs, sorted numerically |
| Investigator deployment | 3 crossing indices, yellow / blue / red |
| Jack's initial public start | 1 circle ID |
| Jack movement | 1 move type (street 0, coach 1, alley 2, boat 3), then 1 destination; coach has 2 destinations |
| Investigator movement | 3 crossing indices, yellow / blue / red |
| Search | 1 circle ID per search, in order |
| Pass or stop a search early | 0 |
| Arrest | 190, then 1 circle ID |

Circle IDs are 1–189. Crossing indices are zero-based indices into the frozen
174-entry dictionary in `src/game/byMail.ts`. Searches advance automatically
when a clue is found or every adjacent location has been checked; otherwise a
zero ends that investigator's action. There is no overhead between consecutive
searches or investigators beyond an explicit early-stop byte when needed.

## Message lengths

Let `T` be the number of Jack/investigator turn pairs, `S` the average searches
per investigator, `P` the number of explicit pass/early-stop actions, and `C`
the number of coach moves. With searches rather than arrests:

`bytes = 21 + T × (5 + 3S) + P + C`

The 21 bytes include the 13-byte envelope and 8 setup/start bytes. Unpadded
The full text uses `3 + ceil(bytes × 4 / 3)` characters, including the turn prefix. Each investigator can require
at most one explicit stop per turn, so `0 ≤ P ≤ 3T`.

| Scenario | Full-history text, without coaches |
| --- | --- |
| 30 turn pairs (10 per round), 2 searches per investigator | 471–591 characters |
| 45 turn pairs (15 per round), 3 searches per investigator | 871–1,051 characters |

The upper estimates assume every search phase needs an explicit stop; automatic
completion reduces the size. For a fixed 30 turn pairs, using both coach tiles
adds two bytes, raising the upper bound to 594 characters. The 45 figure counts
move-track slots only when every movement costs one slot: coaches consume two
slots and therefore reduce the maximum number of actual turn pairs. An early
loss may also omit the last investigator turn. Arrests replace that
investigator's searches with a two-byte record.

The initial invitation is 26 characters. The deployment reply is 30 characters.
V1 omits the four-byte finish time; v2 adds five or six text characters.
For any host, exact link length is simply the current app URL plus `#mail=`
plus the text length. The UI displays the actual text length for each message.

## QR sharing

The sharing screen remembers whether the QR code is expanded and whether it
contains an app link (default) or compact binary in localStorage. Link codes use
the current deployment URL, including the GitHub Pages path. Binary codes carry
exactly the wire bytes described above, starting with the four-byte game ID;
they omit Base64 and the text-only turn prefix. The reader validates the checksum
and replays the history before reconstructing the prefixed text.

Scan QR code uses the device camera to read links and binary codes and fill
the partner-message field. Joining,
reply validation, and correction review still require their usual load buttons.
Binary codes require this app's reader; link codes also work with ordinary phone
camera apps. Camera access requires HTTPS (or localhost) and browser permission.
Camera tracks stop on success, cancellation, and leaving the reader screen.

Generation and reading use zxing-wasm's prebuilt full module, loaded on demand
and bundled as a same-origin Vite asset; no WASM build or CDN is required.
Codes use QR byte mode for binary data and low error correction. A game that
exceeds single-code capacity displays an error with the existing text/link options.
