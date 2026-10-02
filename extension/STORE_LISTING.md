# Store submission draft

**Name:** Alpha Bro Companion

**Summary:** Capture and annotate local app previews in Alpha Bro, with improved iframe compatibility.

**Description:** Keep your chat and development preview together. Connect your Alpha Bro address, then use Capture to screenshot the visible preview without a screen-sharing picker. Continue marking up the image in Alpha Bro’s existing annotation editor. The companion also helps local development apps load inside the preview by relaxing framing restrictions only for that active preview in your connected tab. Chrome and Edge desktop, version 116 or later, are supported. Your browser and development server must run on the same machine. Alpha Bro itself may use a trusted HTTP(S) address, including Tailscale. This extension does not provide access to remote dev servers.

**Single purpose:** Integrate the local Alpha Bro development preview with browser screenshot, frame loading and navigation capabilities.

**Permission justification:**

- Site access (`<all_urls>`): required by Chrome’s visible-tab capture API for the webapp Capture button without a separate extension invocation. Commands are accepted only from explicitly paired Alpha Bro origins.
- `tabs`: checks the requesting tab is active, verifies its address, and presents local setup.
- `webNavigation`: identifies the direct preview iframe and observes its route changes.
- `declarativeNetRequestWithHostAccess`: removes framing restrictions from the registered local preview’s subframe responses only in the connected tab.
- `storage`: remembers explicitly connected Alpha Bro origins and active preview sessions. Does not store screenshots.

**Privacy disclosure draft:** The extension processes the visible browser tab locally to produce a cropped preview screenshot. Full-tab pixels are transient and are not persisted. The cropped image is sent only to the connected Alpha Bro page for annotation and user-directed attachment. The extension stores connected Alpha Bro origins and active preview URLs locally to provide its features. It sends no telemetry and contains no remote executable code. Alpha Bro’s own handling of attachments is separate from extension storage.

Before publication: provide a hosted privacy-policy URL; complete the store’s data disclosures based on the complete Alpha Bro flow; supply real store screenshots; verify the copied Alpha Bro icon is the intended release branding. Upload `dist/alpha-bro-extension-store.zip` (manifest at archive root), not the unpacked-install archive. Publication and store review are separate from building this repository.
