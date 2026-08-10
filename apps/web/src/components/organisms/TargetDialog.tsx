import { useEffect, useState } from 'react';
import { Server } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/atoms/Spinner';
import { cn } from '@/lib/utils';
import type { TargetInput } from '@/api';
import type { ProviderKind, RuntimeKind, Target } from '@/types';

const ALL_CAPS: { id: RuntimeKind; label: string }[] = [
  { id: 'static', label: 'Static' },
  { id: 'node', label: 'Node' },
  { id: 'php', label: 'PHP' },
  { id: 'python', label: 'Python' },
];

interface Props {
  open: boolean;
  // The target being edited, or null when registering a new one.
  target: Target | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TargetInput) => void;
}

const selectCls =
  'h-11 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-9';

function defaultCapabilities(kind: ProviderKind): RuntimeKind[] {
  // The primary SFTP use case is shared PHP hosting (ESO included). Keeping
  // both choices visible below still lets the user opt into static-only.
  if (kind === 'docker') return ['static', 'node', 'php', 'python'];
  return kind === 'sftp' ? ['static', 'php'] : ['node'];
}

// Register or edit one of the user's own deployment targets (a server the
// platform can deploy to). Built-in targets are read-only and never edited here.
export function TargetFormDialog({ open, target, busy, onOpenChange, onSubmit }: Props) {
  const editing = !!target;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ProviderKind>('docker');
  const [caps, setCaps] = useState<RuntimeKind[]>(defaultCapabilities('docker'));
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [auth, setAuth] = useState<'password' | 'key'>('password');
  const [secret, setSecret] = useState('');
  const [remotePath, setRemotePath] = useState('');
  const [publicUrl, setPublicUrl] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(target?.name ?? '');
    setKind(target?.kind ?? 'docker');
    setCaps(target?.capabilities ?? defaultCapabilities('docker'));
    setHost(target?.host ?? '');
    setPort(String(target?.port ?? 22));
    setUsername(target?.username ?? '');
    setAuth((target?.auth as 'password' | 'key') ?? 'password');
    setSecret('');
    setRemotePath(target?.remotePath ?? '');
    setPublicUrl(target?.publicUrl ?? '');
  }, [open, target]);

  function toggleCap(c: RuntimeKind) {
    setCaps((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  }

  function changeKind(next: ProviderKind) {
    setKind(next);
    if (!editing) setCaps(defaultCapabilities(next));
  }

  const valid =
    name.trim() &&
    publicUrl.trim() &&
    caps.length > 0 &&
    (kind === 'docker' || (
      host.trim() &&
      username.trim() &&
      remotePath.trim() &&
      (editing || secret.trim())
    ));

  function submit() {
    const common = {
      name: name.trim(),
      kind,
      capabilities: caps,
      publicUrl: publicUrl.trim(),
    };
    onSubmit(kind === 'docker' ? common : {
      ...common,
      host: host.trim(),
      port: Number(port) || 22,
      username: username.trim(),
      auth,
      secret: secret.trim() || undefined,
      remotePath: remotePath.trim(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Server className="h-[18px] w-[18px]" /> {editing ? 'Edit target' : 'Add a target'}
          </DialogTitle>
          <DialogDescription>
            {kind === 'docker'
              ? 'A Docker server that connects outbound to InitPad through an Agent. No inbound SSH credentials are stored.'
              : 'A remote server the platform reaches over SSH/SFTP. Credentials are encrypted at rest.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="t-name">Name</Label>
            <Input id="t-name" value={name} placeholder="ESO school server" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <select
              className={selectCls}
              value={kind}
              disabled={editing}
              onChange={(e) => changeKind(e.target.value as ProviderKind)}
            >
              <option value="docker">Docker (InitPad Agent)</option>
              <option value="sftp">SFTP (web / PHP hosting)</option>
              <option value="ssh">SSH (runtime app)</option>
            </select>
          </div>
          {kind !== 'docker' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="t-port">Port</Label>
              <Input id="t-port" value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
            </div>
          )}

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>Can run</Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_CAPS.map((c) => {
                const on = caps.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCap(c.id)}
                    aria-pressed={on}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                      on
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40',
                    )}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {kind === 'sftp'
                ? 'Enable PHP for Nette, Laravel and Symfony. PHP deployment also requires shell commands over the same SSH account; static-only SFTP does not.'
                : kind === 'docker'
                  ? 'The Agent will confirm Docker capabilities after enrollment. Deployment remains disabled until the Agent delivery path is ready.'
                  : 'Select only runtimes installed on this server. Test connection reports detected command-line runtimes.'}
            </p>
          </div>

          {kind !== 'docker' && (
            <>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="t-host">Host</Label>
                <Input id="t-host" value={host} placeholder="eso.example.edu" onChange={(e) => setHost(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="t-user">Username</Label>
                <Input id="t-user" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Auth</Label>
                <select className={selectCls} value={auth} onChange={(e) => setAuth(e.target.value as 'password' | 'key')}>
                  <option value="password">Password</option>
                  <option value="key">SSH key</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="t-secret">{auth === 'key' ? 'Private key (PEM)' : 'Password'}</Label>
                {auth === 'key' ? (
                  <textarea
                    id="t-secret"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={editing ? 'Leave blank to keep the existing key' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
                    className="min-h-[84px] w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                ) : (
                  <Input
                    id="t-secret"
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={editing ? 'Leave blank to keep the existing password' : ''}
                  />
                )}
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="t-path">Remote path</Label>
                <Input id="t-path" value={remotePath} placeholder="/www/myapp" onChange={(e) => setRemotePath(e.target.value)} />
              </div>
            </>
          )}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="t-url">{kind === 'docker' ? 'Application base URL' : 'Public URL'}</Label>
            <Input
              id="t-url"
              value={publicUrl}
              placeholder={kind === 'docker' ? 'http://192.168.1.50' : 'https://eso.example.edu/~user'}
              onChange={(e) => setPublicUrl(e.target.value)}
            />
            {kind === 'docker' && (
              <p className="text-xs text-muted-foreground">
                Browser-reachable host of this server. Agent-managed applications will receive their own published port.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !valid} onClick={submit}>
            {busy && <Spinner className="h-4 w-4" />}
            {editing ? 'Save target' : 'Add target'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
