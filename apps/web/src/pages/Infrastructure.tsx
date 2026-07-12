import { useCallback, useEffect, useState } from 'react';
import {
  Cloud,
  Container,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  Wifi,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, type TargetInput } from '@/api';
import { useToast } from '@/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/molecules/PageHeader';
import { EmptyState } from '@/components/molecules/EmptyState';
import { Spinner } from '@/components/atoms/Spinner';
import { TargetFormDialog } from '@/components/organisms/TargetDialog';
import type { ProviderKind, Target } from '@/types';

const KIND_ICON: Record<ProviderKind, LucideIcon> = {
  docker: Container,
  ssh: Server,
  sftp: Cloud,
};

function TargetCard({
  target,
  busy,
  onVerify,
  onEdit,
  onDelete,
}: {
  target: Target;
  busy: boolean;
  onVerify: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = KIND_ICON[target.kind] ?? Server;
  const isUser = target.scope === 'user';
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{target.name}</div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {target.kind} · {target.scope === 'builtin' ? 'built-in' : 'your server'}
            </div>
          </div>
        </div>
        {target.verifiedAt ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-success" title={`Verified ${new Date(target.verifiedAt).toLocaleString()}`}>
            <ShieldCheck className="h-3.5 w-3.5" /> verified
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" /> not verified
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {target.capabilities.map((c) => (
          <span key={c} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            {c}
          </span>
        ))}
      </div>

      {(target.host || target.publicUrl) && (
        <div className="flex flex-col gap-0.5 font-mono text-xs text-muted-foreground">
          {target.host && <span className="truncate">{target.username ? `${target.username}@` : ''}{target.host}{target.port ? `:${target.port}` : ''}</span>}
          {target.publicUrl && <span className="truncate">{target.publicUrl}</span>}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button variant="secondary" size="sm" disabled={busy} onClick={onVerify}>
          {busy ? <Spinner className="h-4 w-4" /> : <Wifi className="h-4 w-4" />} Test connection
        </Button>
        {isUser && (
          <>
            <Button variant="ghost" size="icon-sm" aria-label="Edit target" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete target"
              disabled={busy || target.inUse}
              title={target.inUse ? 'In use by an environment' : 'Delete target'}
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

export default function Infrastructure() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Target | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    api
      .listTargets()
      .then(setTargets)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  async function submit(values: TargetInput) {
    setSaving(true);
    try {
      if (editing) await api.updateTarget(editing.id, values);
      else await api.createTarget(values);
      toast.success(editing ? 'Target saved' : 'Target added');
      setFormOpen(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function verify(t: Target) {
    setBusyId(t.id);
    try {
      const r = await api.verifyTarget(t.id);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(t: Target) {
    setBusyId(t.id);
    try {
      await api.deleteTarget(t.id);
      toast.success(`Removed ${t.name}`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const builtins = targets.filter((t) => t.scope === 'builtin');
  const mine = targets.filter((t) => t.scope === 'user');

  return (
    <div>
      <PageHeader
        title="Infrastructure"
        subtitle="Where projects deploy. Built-in targets are the simulated company infra; add your own servers for production."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add target
          </Button>
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {!loading && (
        <div className="flex flex-col gap-8">
          <section>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Built-in (simulated infrastructure)
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {builtins.map((t) => (
                <TargetCard key={t.id} target={t} busy={busyId === t.id} onVerify={() => verify(t)} onEdit={() => {}} onDelete={() => {}} />
              ))}
            </div>
          </section>

          <section>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your targets
            </p>
            {mine.length === 0 ? (
              <EmptyState
                icon={Server}
                title="No targets yet"
                description="Register a server (e.g. your school SFTP host or a VPS) to deploy production there."
                action={
                  <Button
                    onClick={() => {
                      setEditing(null);
                      setFormOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" /> Add target
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {mine.map((t) => (
                  <TargetCard
                    key={t.id}
                    target={t}
                    busy={busyId === t.id}
                    onVerify={() => verify(t)}
                    onEdit={() => {
                      setEditing(t);
                      setFormOpen(true);
                    }}
                    onDelete={() => remove(t)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <TargetFormDialog
        open={formOpen}
        target={editing}
        busy={saving}
        onOpenChange={setFormOpen}
        onSubmit={submit}
      />
    </div>
  );
}
