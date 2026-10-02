# Alpha Bro Companion

Chrome / Edge Manifest V3 companion for local development previews in Alpha Bro. Requires Chromium 116 or newer. The existing Tauri launcher and webapp remain unchanged in architecture; the iframe connects directly to the local dev server.

## Development installation

Run `npm --prefix extension run build` from the repository root. Open `chrome://extensions` (or `edge://extensions`), enable Developer mode, choose **Load unpacked**, and select `extension/dist/alpha-bro-extension`. Open or reload the Alpha Bro page. Any HTTP(S) address on port 3300 connects automatically, including localhost, Tailscale IPs, and other hostnames. For other ports, click the companion toolbar button, verify the exact origin, and connect it. The webapp’s installation dialog links to a generated guide and ZIP at `/extension/install.html`.

Rebuild and click Reload on the browser extension card after code changes, then reload Alpha Bro. Unit tests: `npm --prefix extension test`.

## Permissions and boundaries

`<all_urls>` is required by `captureVisibleTab` for in-page capture without a fresh toolbar invocation. The extension accepts commands from top-level HTTP(S) pages on port 3300 on any hostname, plus explicitly connected origins on other ports. Port 3300 is automatically trusted and is not a manually disconnectable entry. Connecting an origin grants scripts served by that origin capture access; only connect trusted Alpha Bro instances. It checks active-tab and focused-window state before and after capture. Full tab pixels are transient, cropped in the extension, and never saved. Only the crop is returned to Alpha Bro’s existing annotation flow.

Preview origins are restricted to HTTP(S) localhost, 127.0.0.1 and [::1]. The dev server origin must differ from the Alpha Bro origin. Session DNR rules remove X-Frame-Options and enforcing Content-Security-Policy for subframe documents at the exact registered preview origin in that tab. This deliberately matches the former development proxy behavior; it does not selectively remove only frame-ancestors. Other tabs and external origins are unaffected. Disconnection of a manually paired origin, tab closure, top-level navigation and unregistering remove these rules. Active sessions survive extension service-worker suspension via storage.session; screenshots never enter storage.

External redirects, nested third-party frames, site cookies/authentication, frame-busting scripts and iframe sandbox policies can still prevent embedding. Use Open in new tab in those cases. The Alpha Bro owner page may use any HTTP(S) origin on port 3300 or an explicitly paired origin on another port, including Tailscale. Dev-server previews still connect only to the browser machine’s loopback interface; remote dev-server preview routing is not provided.

## Protocol

Page requests: `{source:'alpha-bro-page',version:1,id,action,payload}` via same-window `postMessage`. Responses: `{source:'alpha-bro-extension',version:1,id,ok,result,error}`. Navigation events omit id and carry `event:'navigation'`, `sessionId`, and `payload:{url,pathname,canGoBack,canGoForward}`. Registered previews are bound to the browser tab, exact origin and direct child frame. A tab supports one active preview session.

Actions: `hello`, `openSetup`, `registerPreview`, `unregisterPreview`, `capture`, `navigate`. `hello` returns `{connected,permissions,version:1}` before pairing. `openSetup` presents an explicit connect action; it never pairs silently. Register payload: `{sessionId,taskId,url}`. Capture payload: `{sessionId,rect:{x,y,width,height},viewport:{width,height},url}`. Navigate payload: `{sessionId,command:'back'|'forward'|'reload'|'to',path?}`.

## Release checklist

The build produces a self-contained unpacked folder and ZIP without dependencies. Store publication is not automated. Prepare store artwork/icons, verify screenshots and privacy text against the release, submit to Chrome Web Store / Edge Add-ons, and replace the webapp installation link via its documented configuration after approval. No placeholder store listing is embedded.

Manual checks: pair and disconnect; absent/disabled extension dialog; repeated capture with no screen-sharing picker; zoom and display scaling; annotation and attachments; restrictive XFO/CSP preview plus unaffected second tab; SPA route/back/forward/hash; direct HMR and redirects; tab switch during capture; task switch; worker suspension; restart; IPv4 and IPv6 localhost.
