import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/stage3.css';
import './styles/stage6.css';
import './styles/stage7.css';
import './tutorial.css';

const container = document.getElementById('root');
if (!container) throw new Error('Chatter root element is missing');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register the offline shell worker. Private /api traffic is never cached by it.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installation support is optional; a failed registration must not break the app.
    });
  });
}
