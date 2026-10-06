import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Lock, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/atoms/Spinner';
import { api, type ConfigVar } from '@/api';
import { useToast } from '@/toast';
import type { EnvName } from '@/types';
import { useConfirmation } from '@/confirmation';

interface Props {
  projectId: string;
  env: EnvName | null;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void> | void;
}

// Per-environment application config & secrets (ADR-061). Secret values are never
// shown (the API masks them); a secret can be replaced by entering a new value.
export function EnvVarsDialog({ projectId, env, canManage, onOpenChange, onChanged }: Props) {
  const [vars, setVars] = useState<ConfigVar[]>([]);
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [isSecret, setIsSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const toast = useToast();
  const confirmAction = useConfirmation();

  const load = useCallback(() => {
    if (!env) return;
    setLoading(true);
    api
      .listConfigVars(projectId, env)
      .then(setVars)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [projectId, env, toast]);

  useEffect(() => {
    if (env) load();
  }, [env, load]);

  async function save() {
    if (!env) return;
    const normalizedKey = key.trim();
    const existing = vars.find((variable) => variable.key === normalizedKey);
    if (existing) {
      const confirmed = await confirmAction({
        title: `Replace ${normalizedKey} in ${env}?`,
        description: 'The current value cannot be recovered from InitPad after it is overwritten.',
        confirmLabel: existing.isSecret ? 'Replace secret' : 'Replace variable',
        tone: 'warning',
        consequences: [
          existing.isSecret
            ? 'The stored secret value is replaced.'
            : 'The stored configuration value is replaced.',
          'The running workload is unchanged until the environment is redeployed.',
        ],
      });
      if (!confirmed) return;
    }
    setSaving(true);
    try {
      await api.upsertConfigVar(projectId, env, normalizedKey, { value, isSecret });
      toast.success(`Saved ${normalizedKey}`);
      setKey('');
      setValue('');
      setIsSecret(false);
      load();
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(k: string) {
    if (!env) return;
    const variable = vars.find((candidate) => candidate.key === k);
    const confirmed = await confirmAction({
      title: `Delete ${k} from ${env}?`,
      description: variable?.isSecret
        ? 'The encrypted secret value cannot be recovered after deletion.'
        : 'The configuration value cannot be recovered after deletion.',
      confirmLabel: variable?.isSecret ? 'Delete secret' : 'Delete variable',
      tone: 'danger',
      consequences: [
        'The variable is removed from the next deployment configuration.',
        'The currently running workload is unchanged until the environment is redeployed.',
      ],
    });
    if (!confirmed) return;
    setDeletingKey(k);
    try {
      await api.deleteConfigVar(projectId, env, k);
      load();
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeletingKey(null);
    }
  }

  const validKey = /^[A-Z_][A-Z0-9_]*$/.test(key.trim());

  return (
    <Dialog open={env !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <KeyRound className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
            <span>
              Environment variables — <span className="uppercase">{env}</span>
            </span>
          </DialogTitle>
          <DialogDescription>
            Runtime config and secrets injected into this environment on the next deploy. Redeploy
            to apply changes. Secret values are stored encrypted and never shown again.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-5 w-5 text-primary" />
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            {vars.length === 0 ? (
              <p className="rounded-lg bg-muted px-3.5 py-3 text-sm text-muted-foreground">
                No variables yet.
              </p>
            ) : (
              <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
                {vars.map((v) => (
                  <li key={v.key} className="flex min-w-0 items-center gap-3 px-3.5 py-2.5">
                    <span className="shrink-0 text-muted-foreground">
                      {v.isSecret ? <Lock className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                    </span>
                    {/* Key above value: neither has to fight the other for width. */}
                    <span className="min-w-0 flex-1">
                      <span className="block break-all font-mono text-[13px] font-medium">
                        {v.key}
                      </span>
                      <span
                        className="block truncate font-mono text-xs text-muted-foreground"
                        title={v.isSecret ? undefined : (v.value ?? undefined)}
                      >
                        {v.isSecret ? '••••••••' : v.value}
                      </span>
                    </span>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${v.key}`}
                        className="shrink-0 rounded-full hover:bg-destructive/10 hover:text-destructive"
                        disabled={deletingKey === v.key}
                        onClick={() => void remove(v.key)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canManage && (
              <div className="flex min-w-0 flex-col gap-3 rounded-lg bg-muted p-3.5">
                <p className="text-sm font-medium">Add or update a variable</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    placeholder="KEY"
                    aria-label="Variable key"
                    value={key}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setKey(e.target.value.toUpperCase())}
                    className="font-mono"
                  />
                  <Input
                    placeholder="value"
                    aria-label="Variable value"
                    value={value}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setValue(e.target.value)}
                    type={isSecret ? 'password' : 'text'}
                    className="font-mono"
                  />
                </div>
                {key.trim() && !validKey && (
                  <p className="text-xs text-destructive">
                    Key must be UPPER_SNAKE_CASE (A–Z, 0–9, _).
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm sm:min-h-0">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={isSecret}
                      onChange={(e) => setIsSecret(e.target.checked)}
                    />
                    Secret
                    <span className="text-muted-foreground">(encrypted, hidden)</span>
                  </label>
                  <Button size="sm" disabled={!validKey || saving} onClick={() => void save()}>
                    {saving ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}{' '}
                    Save
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
