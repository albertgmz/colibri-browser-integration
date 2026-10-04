# colibri-browser-integration

Colibri's v2 browser extension uses WXT, TypeScript and native messaging with
`com.colibri.host`. It offers eligible GET downloads to the desktop app and keeps
the browser copy paused while the user confirms. Only an explicit accepted response
allows browser cancellation. Link/media menus and checked bulk import are also available.

## Development and loading

Use Node.js 24 and npm. Install the matching Colibri v2 desktop build and register
browser integration from its Browser Integration settings page. The registered
native-host executable must remain at its registered path. Preserve the Chromium
manifest key and Firefox ID (`colibri-browser-integration@colibri.download`);
registration is restricted to those extension identities.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build:all
```

For runtime checks, use disposable browser profiles with sync disabled; never use
real browsing history or credentials for fixtures. Do not install the legacy Colibri
extension alongside this extension in the test profile.

- Chrome: open `chrome://extensions`, enable Developer mode, choose Load unpacked,
  and select `.output/chrome-mv3`.
- Edge: open `edge://extensions`, enable Developer mode, choose Load unpacked,
  and select `.output/edge-mv3`.
- Firefox: open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on,
  and select `.output/firefox-mv3/manifest.json`. Temporary installation ends when
  Firefox closes. Registration must use the fixed Firefox ID.

`npm run dev` starts WXT's Chrome development session. `npm run zip` produces
Chrome, Edge and Firefox archives in `.output`; it does not publish to stores.

## Permissions and privacy

- `downloads`: observe, pause and resume offers; cancel and erase the browser entry
  only after Colibri accepts ownership.
- `nativeMessaging`: communicate with the registered Colibri native host over a
  browser-managed native port. No TCP/WebSocket service is used.
- `cookies`: obtain replay cookies for eligible authenticated downloads. Private
  capture is off by default and uses a separate private cookie store when enabled.
- `webRequest`: observe real request headers, method, redirects and response metadata
  so POST requests are bypassed and final-hop context can be replayed.
- `contextMenus`: expose link, media and bulk-download commands.
- `storage`: cache app-owned capture settings and up to eight filename/result/time
  summaries. Cookies, headers and browsing URLs are not stored in extension history.
- HTTP/HTTPS host access: observe candidate requests and collect page links/modifier
  state through the content script. FTP host access supports explicit link commands;
  automatic observation is HTTP/HTTPS only.

Firefox's manifest declares browsing activity, website content/activity and
authentication information categories because this functionality handles those data
locally and passes needed download context to Colibri. The extension has no telemetry
or remote analytics. Request context lives in a bounded, short-lived memory cache.
Colibri owns capture preferences; the popup updates them through native messaging.

## Ownership and recovery

Startup `hello` checks protocol v2 and `capture-confirmation` support without launching
the desktop app. A compatible `app-not-running` response permits only deliberate
`add`, `bulk-add` or `open` requests to launch it. Unknown/legacy hosts never receive
capture payloads. Closed-app hello responses are not cached.

Pending offers are polled until acceptance, rejection, browser fallback or expiry.
If acceptance wins a cancellation race, the accepted cancellation response still
transfers ownership. Cancellation allows twenty seconds for the app to stop an
in-flight Add/Resume operation. If the correlated cancellation reply explicitly says
`ok: true, state: "pending"`, cleanup has not been confirmed: the extension leaves
the browser copy paused, keeps its entry, and records an attention message in the
popup. Open Colibri and stop its transfer before manually resuming the browser file
from the browser's Downloads page. The extension never resumes it automatically
after this explicit pending reply, including if popup-history storage fails.
An ordinary initial pending offer only means the confirmation dialog is waiting;
it does not establish this cleanup hold.

Invalid replies, timeouts, native disconnects and exceptions
preserve/resume the browser copy. A disconnect that loses both acceptance and the
cancellation reply cannot establish whether Colibri already accepted: the browser
copy is preserved, and a duplicate app transfer can remain. Native transport has no
durable reconciliation across lost replies; this limitation requires manual review
of the app's download list after interrupted handoffs. Browser cancellation can also
fail after confirmed app acceptance; browser recovery then preserves its copy.

See [protocol documentation](https://github.com/albertgmz/Colibri/blob/main/docs/protocol.md) and
[message schema](docs/protocol.schema.json) for the wire contract.

## Choose page links

The page and selection menus open a browser picker with nothing selected. Search
filename, filename extension or domain; Select visible and Clear visible preserve
hidden selections. Excluded links are disabled. Each link retains the collecting
frame's page context. Only exact network URLs are deduplicated; signed query values
stay distinct and are not displayed. Filename extension hints are not verified MIME
types, and sizes remain unknown. Filename categories use the canonical desktop catalog. Selected category counts
include hidden rows. Colibri applies destination/queue settings; the current
protocol has no authoritative destination or queue preview.

Discovery inspects at most 5,000 anchors and returns at most 500 links without
fetching them or transmitting page DOM. Continue in Colibri submits at most 100
selected links after checking current app exclusions/private settings and bulk
capability. A closed compatible app may launch at this deliberate step to supply
current settings. Cookies are collected only for that eligible selection.
Colibri's existing checked confirmation remains authoritative.

Picker sessions are memory-only, tab-owned, limited to eight and expire after five
minutes before submission. Closing/navigating away invalidates preparation; reload
of the same picker retains its state. Already submitted offers continue resolving
authoritative acceptance for up to five minutes. A picker cannot repeat an offer,
including after a lost reply. Review Colibri before deliberately collecting again
after an uncertain result. This flow never cancels browser download copies and
does not claim per-item reconciliation or exactly-once behavior.

## Debugging and validation

Inspect the extension background/service worker from the browser's extension page
(Firefox uses the Inspect button in `about:debugging`). Check popup connection status,
native-host registration and executable paths first. Use a controlled local HTTP
fixture and sanitized messages: never print cookies, Authorization values, URL query
strings or native request payloads in console output or issue reports.

Exercise closed-app hello then intentional open/add, successful confirmation,
rejection, browser fallback, duplicate resume, native disconnect, redirect context,
pending cancellation cleanup (browser stays paused with popup attention),
POST bypass, site/modifier exclusions, and private capture opt-in. Chrome/Edge use
`onDeterminingFilename`; Firefox uses `onCreated`, so pause/cancel timing must be
verified in each browser. Building and unit tests alone do not establish runtime
browser behavior.

CI runs typecheck, lint, tests and all three zip builds. Canonical schema/design-token
drift uses the sibling `../Colibri` checkout locally, or `COLIBRI_APP_ROOT` when set.
CI checks out `albertgmz/Colibri` and always runs the drift test against it.

Temporary bypass follows a trusted initiating anchor click, exact URL including
signed query, tab, frame and private context. A newer click supersedes the previous
intent for that link; the intent expires after ten seconds and is consumed once.
Unrelated clicks do not bypass another download. Request context remains bounded
to 256 entries and sixty seconds; ambiguity or a conflicting final URL keeps the
browser copy. Redirects clear prior headers and response metadata.

The explicit Download with Colibri link/media menu is the deliberate override for
automatic capture preferences. It fetches current desktop settings before cookies
and remains subject to private policy, scoped exclusions and desktop confirmation.
Concurrent events for the same browser download share a local handoff; this does
not reconcile offers across extension/app restart or a lost native reply.

## Choose page media

Choose page media with Colibri opens a temporary picker in the invoked frame only.
It is off until this deliberate menu command; nothing is scanned automatically.
It scans at most 64 media elements and eight child sources each, examines at most
128 candidates and lists at most twenty distinct HTTP(S) filename audio/video
hints. Signed queries remain distinct but are absent from displayed text. Size
and quality stay unknown; source filenames/categories do not verify content.
The picker does not fetch/probe candidates, parse manifests or alter playback.

Observed mediaKeys/encrypted/waitingforkey protection suppresses affected sources,
including duplicate URLs within the bounded snapshot. Undetected encryption or
nonstandard player sources cannot be classified reliably without desktop support.
Blob URLs, credential-bearing URLs and ordinary HLS/DASH filename manifests are
omitted. Extensions without known audio/video filenames are not offered here.
Existing direct media context-menu downloads remain available.

Each picker has a two-minute, memory-only tab/frame/private/page session. DOM source
changes refresh eligible rows. Close, navigation or expiry invalidates preparation;
checks after native/config/cookie waits prevent a late offer. After submission,
the desktop confirmation outcome remains authoritative even if the picker closes.
Choose one source per session; no automatic resend follows a lost reply. Current
desktop exclusions/private settings are rechecked before credentials or add.
Private mode remains off by default. This flow never cancels a browser download.

HLS/DASH track/quality selection, yt-dlp/FFmpeg and torrent/magnet delegation need
new advertised desktop APIs. No such capabilities or fields are advertised by
this extension.
