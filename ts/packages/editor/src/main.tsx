import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
// Self-hosted UI + code fonts (bundled, so the editor works offline).
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
// Tokens first: everything below resolves var()s against them.
import '@cuboidy/ui/tokens.css';
import '@cuboidy/ui/chrome.css';
import '@cuboidy/ui/dock.css';
import '@cuboidy/ui/tree.css';
import '@cuboidy/ui/fields.css';
import '@cuboidy/ui/transport.css';
import '@cuboidy/ui/viewport.css';
import './styles.css';

const rootEl = document.getElementById('root');
if (rootEl === null) {
  throw new Error('Root element #root not found in document');
}
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
