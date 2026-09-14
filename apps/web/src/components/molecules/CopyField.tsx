import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

type CopyState = 'idle' | 'copied' | 'failed';

function copyWithSelection(value: string): boolean {
  const field = document.createElement('textarea');
  field.value = value;
  field.readOnly = true;
  field.setAttribute('aria-hidden', 'true');
  field.style.position = 'fixed';
  field.style.inset = '0 auto auto -9999px';
  field.style.opacity = '0';
  document.body.appendChild(field);

  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  try {
    field.focus();
    field.select();
    field.setSelectionRange(0, value.length);
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    focused?.focus({ preventScroll: true });
  }
}

async function writeClipboard(value: string): Promise<boolean> {
  // The Clipboard API is intentionally unavailable on non-localhost HTTP
  // origins. Keep LAN/self-hosted installs usable with the synchronous,
  // user-gesture-bound selection fallback supported by desktop browsers.
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Permission policy or browser settings may still block it.
    }
  }
  return copyWithSelection(value);
}

// Molecule: a monospaced command with a copy-to-clipboard button.
export function CopyField({ command }: { command: string }) {
  const [state, setState] = useState<CopyState>('idle');

  async function copy() {
    const copied = await writeClipboard(command);
    setState(copied ? 'copied' : 'failed');
    if (copied) window.setTimeout(() => setState('idle'), 1500);
  }

  return (
    <div className="min-w-0 max-w-full">
      <div className="flex min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-md border border-border bg-secondary/50 px-3 py-2.5">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-foreground/90">
          {command}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy to clipboard"
          className="flex shrink-0 items-center gap-1 rounded text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {state === 'copied' ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {state === 'copied' ? 'copied' : 'copy'}
        </button>
      </div>
      {state === 'failed' && (
        <p className="mt-1.5 text-xs text-destructive" role="alert">
          Clipboard access is blocked. Select the text and press Ctrl+C (Cmd+C on macOS).
        </p>
      )}
    </div>
  );
}
