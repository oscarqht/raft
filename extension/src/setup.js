import { ownerUrl } from './core.js';
const status = document.getElementById('status');
const button = document.getElementById('connect');
let origin;
async function render() {
  const { connectedOrigins = [] } = await chrome.storage.local.get('connectedOrigins');
  const list = document.getElementById('connections');
  list.replaceChildren();
  for (const address of connectedOrigins) {
    const item = document.createElement('li');
    item.append(document.createTextNode(address));
    const remove = document.createElement('button');
    remove.textContent = 'Disconnect';
    remove.onclick = async () => {
      const current = await chrome.storage.local.get('connectedOrigins');
      await chrome.storage.local.set({ connectedOrigins: (current.connectedOrigins || []).filter(value => value !== address) });
      await render();
    };
    item.append(remove);
    list.append(item);
  }
  button.textContent = connectedOrigins.includes(origin) ? 'Connected' : 'Connect this Alpha Bro address';
  button.disabled = !origin || connectedOrigins.includes(origin);
}
try {
  const requested = new URL(location.href).searchParams.get('origin');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  origin = ownerUrl(requested || tab?.url).origin;
  document.getElementById('origin').textContent = origin;
} catch {
  document.getElementById('origin').textContent = 'Open your Alpha Bro page, then click the extension toolbar button to connect.';
}
button.onclick = async () => {
  try {
    const allowed = await chrome.permissions.contains({ origins: ['<all_urls>'] });
    if (!allowed) { status.textContent = 'Allow access to all sites in browser extension settings, then try again.'; return; }
    const { connectedOrigins = [] } = await chrome.storage.local.get('connectedOrigins');
    await chrome.storage.local.set({ connectedOrigins: [...new Set([...connectedOrigins, origin])] });
    status.textContent = 'Connected. Return to Alpha Bro and choose Check again.';
    await render();
  } catch (error) { status.textContent = error.message; }
};
await render();
