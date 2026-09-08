import { useEffect, useState } from 'react';
import { Download, TableProperties } from 'lucide-react';
import { api } from '@/api';
import { Spinner } from '@/components/atoms/Spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/toast';

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultPeriod(): { from: string; to: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { from: localDate(start), to: localDate(end) };
}

export function WorkspaceMetricsDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<'csv' | 'json' | null>(null);

  useEffect(() => {
    if (!open) return;
    const period = defaultPeriod();
    setFrom(period.from);
    setTo(period.to);
    setBusy(null);
  }, [open]);

  const valid = Boolean(from && to && from <= to);

  async function exportMetrics(format: 'csv' | 'json') {
    if (!valid) return;
    setBusy(format);
    try {
      const file = await api.downloadWorkspaceMetrics(workspaceId, format, from, to);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(`${format.toUpperCase()} metrics downloaded`);
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle><TableProperties className="h-[18px] w-[18px]" /> Export workspace metrics</DialogTitle>
          <DialogDescription>
            Deployment counts and durations only. Logs, secrets and account data are excluded.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="metrics-from">From</Label>
            <Input
              id="metrics-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="metrics-to">Through</Label>
            <Input
              id="metrics-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </div>
        {!valid && from && to && (
          <p role="alert" className="text-xs text-destructive">End date must not be before start date.</p>
        )}

        <DialogFooter>
          <Button variant="secondary" disabled={!!busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="secondary" disabled={!valid || !!busy} onClick={() => exportMetrics('json')}>
            {busy === 'json' ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            JSON
          </Button>
          <Button disabled={!valid || !!busy} onClick={() => exportMetrics('csv')}>
            {busy === 'csv' ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
