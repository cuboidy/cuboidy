import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@cuboidy/ui/chrome.css';
import '@cuboidy/ui/dock.css';
import '@cuboidy/ui/tree.css';
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
