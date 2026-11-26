import { installInspector } from '@uxerjs/universal-inspector';

// Existing repositories and plain HTML do not necessarily wrap their app in a provider.
// Run the shared inspector inside this document, with an exact same-origin parent.
if (window.parent !== window && window.parent.location.origin === window.location.origin) {
  const inspector = installInspector({
    allowedParentOrigins: [window.location.origin],
    parentOrigin: window.location.origin,
  });
  window.addEventListener('pagehide', () => inspector.dispose(), { once: true });
}
