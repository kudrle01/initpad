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
}

// Per-environment application config & secrets (ADR-061). Secret values are never
// shown (the API masks them); a secret can be replaced by entering a new value.
export function EnvVarsDialog({ projectId, env, canManage, onOpenChange }: Props) {
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
          <DialogTitle>Environment variables — {env}</DialogTitle>
          <DialogDescription>
            Runtime config and secrets injected into this environment on the next deploy. Redeploy
            to apply changes. Secret values are stored encrypted and never shown again.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-5 w-5" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {vars.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">No variables yet.</p>
            )}
            {vars.map((v) => (
              <div key={v.key} className="flex items-center gap-2 rounded-md border px-3 py-2">
                <span className="text-muted-foreground">
                  {v.isSecret ? <Lock className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                </span>
                <span className="min-w-0 break-all font-mono text-sm font-medium">{v.key}</span>
                <span className="ml-1 min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {v.isSecret ? '••••••••' : v.value}
                </span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${v.key}`}
                    className="ml-auto"
                    disabled={deletingKey === v.key}
                    onClick={() => void remove(v.key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}

            {canManage && (
              <div className="mt-2 flex flex-col gap-2 rounded-md border border-dashed p-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder="KEY"
                    value={key}
                    onChange={(e) => setKey(e.target.value.toUpperCase())}
                    className="font-mono"
                  />
                  <Input
                    placeholder="value"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    type={isSecret ? 'password' : 'text'}
                    className="font-mono"
                  />
                </div>
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={isSecret}
                      onChange={(e) => setIsSecret(e.target.checked)}
                    />
                    Secret (encrypted, hidden)
                  </label>
                  <Button
                    size="sm"
                    className="self-end sm:self-auto"
                    disabled={!validKey || saving}
                    onClick={() => void save()}
                  >
                    {saving ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Save
                  </Button>
                </div>
                {key.trim() && !validKey && (
                  <p className="text-xs text-destructive">
                    Key must be UPPER_SNAKE_CASE (A–Z, 0–9, _).
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
