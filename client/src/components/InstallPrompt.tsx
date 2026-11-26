import { useEffect, useState } from 'react';
import { IconDownload, IconX } from './icons';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'chatter:install-dismissed';

/**
 * Surfaces the browser's real install prompt. Nothing is rendered when the PWA
 * is already installed, unsupported, or the member dismissed the card before.
 */
export function InstallPrompt({ compact = false }: { compact?: boolean }) {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (window.matchMedia?.('(display-mode: standalone)').matches) setInstalled(true);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!prompt || installed || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Storage can be unavailable in private mode; dismissal just won't persist.
    }
  };

  const install = async () => {
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // The browser can withdraw the prompt; the card simply stays visible.
    } finally {
      setPrompt(null);
    }
  };

  return (
    <div className="install-card" style={compact ? { padding: '11px 12px' } : undefined}>
      <div className="install-logo" aria-hidden="true" />
      <div className="install-copy">
        <strong>Install Chatter</strong>
        <span>Launch Chatter like an app, with its own window and icon.</span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn btn-sm btn-primary" onClick={install}>
          <IconDownload size={14} /> Install
        </button>
        <button type="button" className="icon-btn" aria-label="Dismiss install prompt" onClick={dismiss}>
          <IconX size={15} />
        </button>
      </div>
    </div>
  );
}
