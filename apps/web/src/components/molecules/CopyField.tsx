import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

// Molecule: a monospaced command with a copy-to-clipboard button.
export function CopyField({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-md border border-border bg-secondary/50 px-3 py-2.5">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-foreground/90">
        {command}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(command).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => setCopied(false),
          );
        }}
        className="flex shrink-0 items-center gap-1 rounded text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}
