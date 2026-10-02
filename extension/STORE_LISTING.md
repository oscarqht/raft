# Store submission draft

**Name:** Alpha Bro Companion

**Summary:** Capture and annotate local app previews in Alpha Bro, with improved iframe compatibility.

**Description:** Keep your chat and development preview together. Open Alpha Bro on port 3300 (automatically connected), then use Capture to screenshot the visible preview without a screen-sharing picker. Continue marking up the image in Alpha Bro’s existing annotation editor. The companion also helps local development apps load inside the preview by relaxing framing restrictions for all HTTP(S) iframe documents in the Alpha Bro tab while its preview is active, including external redirects and nested frames. Chrome and Edge desktop, version 116 or later, are supported. Your browser and development server must run on the same machine. Alpha Bro itself may use an HTTP(S) address on port 3300, including Tailscale. External navigation loads directly in the browser; this extension does not proxy remote dev servers.

**Single purpose:** Integrate the local Alpha Bro development preview with browser screenshot, frame loading and navigation capabilities.

**Permission justification:**

- Site access (`<all_urls>`): required by Chrome’s visible-tab capture API for the webapp Capture button without a separate extension invocation. Commands are accepted from any HTTP(S) page on port 3300. Other ports are unsupported.
- `tabs`: checks the requesting tab is active and verifies its address.
- `webNavigation`: identifies the direct preview iframe and observes its route changes.
- `declarativeNetRequestWithHostAccess`: removes X-Frame-Options and enforcing CSP from all HTTP(S) subframe responses only in the connected tab while its preview session is active.
- `storage`: remembers active preview sessions for service-worker recovery. Does not store screenshots.

**Privacy disclosure draft:** The extension processes the visible browser tab locally to produce a cropped preview screenshot. Full-tab pixels are transient and are not persisted. The cropped image is sent only to the connected Alpha Bro page for annotation and user-directed attachment. The extension stores active preview URLs in browser session storage to provide its features. It sends no telemetry and contains no remote executable code. Alpha Bro’s own handling of attachments is separate from extension storage.

Before publication: provide a hosted privacy-policy URL; complete the store’s data disclosures based on the complete Alpha Bro flow; supply real store screenshots; verify the copied Alpha Bro icon is the intended release branding. Upload `dist/alpha-bro-extension-store.zip` (manifest at archive root), not the unpacked-install archive. Publication and store review are separate from building this repository.
