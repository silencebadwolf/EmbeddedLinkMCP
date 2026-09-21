import React from 'react';
import ReactDOM from 'react-dom/client';
import { App, configureLinktermClient } from '@linkterm/ui';
import '@linkterm/ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
configureLinktermClient(() => window.linkterm ?? null);

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
