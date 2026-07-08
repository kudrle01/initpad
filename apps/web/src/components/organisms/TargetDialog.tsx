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
import type { EnvName, EnvTarget } from '@/types';

export interface TargetBody {
  kind: 'sftp' | 'ssh';
  host: string;
  port: number;
  username: string;
  auth: 'password' | 'key';
  secret?: string;
  path: string;
  publicUrl: string;
}

interface Props {
  env: EnvName | null;
  target: EnvTarget | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (env: EnvName, body: TargetBody) => void;
  onClear: (env: EnvName) => void;
}

const selectCls =
  'h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

export function TargetDialog({ env, target, busy, onOpenChange, onSave, onClear }: Props) {
  const [kind, setKind] = useState<'sftp' | 'ssh'>('sftp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [auth, setAuth] = useState<'password' | 'key'>('password');
  const [secret, setSecret] = useState('');
  const [path, setPath] = useState('');
  const [publicUrl, setPublicUrl] = useState('');

  // Prefill from the existing target when the dialog opens (secret is never
  // sent back to the client, so it stays blank = keep existing).
  useEffect(() => {
    if (!env) return;
    setKind((target?.kind as 'sftp' | 'ssh') ?? 'sftp');
    setHost(target?.host ?? '');
    setPort(String(target?.port ?? 22));
    setUsername(target?.username ?? '');
    setAuth((target?.auth as 'password' | 'key') ?? 'password');
    setSecret('');
    setPath(target?.path ?? '');
    setPublicUrl(target?.publicUrl ?? '');
  }, [env, target]);

  const editing = !!target;
  const valid = host.trim() && username.trim() && path.trim() && publicUrl.trim() && (editing || secret.trim());

  function submit() {
    if (!env) return;
    onSave(env, {
      kind,
      host: host.trim(),
      port: Number(port) || 22,
      username: username.trim(),
      auth,
      secret: secret.trim() || undefined,
      path: path.trim(),
      publicUrl: publicUrl.trim(),
    });
  }

  return (
    <Dialog open={!!env} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Server className="h-[18px] w-[18px]" /> Production server ({env})
          </DialogTitle>
          <DialogDescription>
            Deploy this environment to your own server. The platform uploads and runs your app
            there — credentials are stored encrypted.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <select className={selectCls} value={kind} onChange={(e) => setKind(e.target.value as 'sftp' | 'ssh')}>
              <option value="sftp">SFTP (static / PHP hosting)</option>
              <option value="ssh">SSH (runtime app)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="t-port">Port</Label>
            <Input id="t-port" value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
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
          <div className="col-span-2 flex flex-col gap-1.5">
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
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="t-path">Remote path</Label>
            <Input id="t-path" value={path} placeholder="/www/myapp" onChange={(e) => setPath(e.target.value)} />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="t-url">Public URL</Label>
            <Input id="t-url" value={publicUrl} placeholder="https://eso.example.edu/~user/myapp" onChange={(e) => setPublicUrl(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="items-center">
          {editing && (
            <Button variant="destructive" className="mr-auto" disabled={busy} onClick={() => env && onClear(env)}>
              Remove target
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !valid} onClick={submit}>
            {busy && <Spinner className="h-4 w-4" />}
            {editing ? 'Save target' : 'Save & use'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
