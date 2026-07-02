import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

// Molekula: příkaz v mono fontu s tlačítkem na zkopírování.
export function CopyField({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/50 px-3 py-2.5">
      <code className="overflow-x-auto whitespace-nowrap font-mono text-[13px] text-foreground/90">
        {command}
      </code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="flex shrink-0 items-center gap-1 rounded text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}
