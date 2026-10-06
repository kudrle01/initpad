import { useEffect, useState } from 'react';
import { ScanSearch, Server } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { fieldClassName, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/atoms/Spinner';
import { ChoiceChip } from '@/components/molecules/ChoiceChip';
import { FieldLabel } from '@/components/molecules/FieldLabel';
import { InfoTip } from '@/components/molecules/InfoTip';
import { Notice } from '@/components/molecules/Notice';
import { cn } from '@/lib/utils';
import { api, type TargetInput } from '@/api';
import type { ProviderKind, RuntimeKind, Target, TargetRoutingMode } from '@/types';
import { useConfirmation } from '@/confirmation';
import { useToast } from '@/toast';

const FIELD = 'flex min-w-0 flex-col gap-1';

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

function defaultCapabilities(kind: ProviderKind): RuntimeKind[] {
  // The primary SFTP use case is shared PHP hosting (ESO included). Keeping
  // both choices visible below still lets the user opt into static-only.
  if (kind === 'docker') return ['static', 'node', 'php', 'python'];
  return ['static', 'php'];
}

function validManagedGatewayOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const ipLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(':');
    const dnsName =
      url.hostname.length <= 253 &&
      url.hostname
        .split('.')
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !ipLiteral &&
      url.hostname !== 'localhost' &&
      !url.hostname.endsWith('.localhost') &&
      dnsName
    );
  } catch {
    return false;
  }
}

function normalizeHostKeyFingerprint(value: string): string {
  return value.trim().replace(/=+$/, '');
}

// Register or edit one of the user's own deployment servers. Built-in servers
// are read-only and never edited here.
export function TargetFormDialog({ open, target, busy, onOpenChange, onSubmit }: Props) {
  const confirmAction = useConfirmation();
  const toast = useToast();
  const editing = !!target;
  const reconnectingRemote = Boolean(
    target && target.kind !== 'docker' && target.managementState !== 'active',
  );
  const requiresReconnectCredential = reconnectingRemote && !target?.credentialConfigured;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ProviderKind>('docker');
  const [routingMode, setRoutingMode] = useState<TargetRoutingMode>('direct-port');
  const [caps, setCaps] = useState<RuntimeKind[]>(defaultCapabilities('docker'));
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [auth, setAuth] = useState<'password' | 'key'>('password');
  const [secret, setSecret] = useState('');
  const [hostKeyFingerprint, setHostKeyFingerprint] = useState('');
  const [remotePath, setRemotePath] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [inspectingHostKey, setInspectingHostKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(target?.name ?? '');
    setKind(target?.kind ?? 'docker');
    setRoutingMode(target?.routingMode ?? 'direct-port');
    setCaps(target?.capabilities ?? defaultCapabilities('docker'));
    setHost(target?.host ?? '');
    setPort(String(target?.port ?? 22));
    setUsername(target?.username ?? '');
    setAuth((target?.auth as 'password' | 'key') ?? 'password');
    setSecret('');
    setHostKeyFingerprint(target?.hostKeyFingerprint ?? '');
    setRemotePath(target?.remotePath ?? '');
    setPublicUrl(target?.publicUrl ?? '');
    setInspectingHostKey(false);
  }, [open, target]);

  function toggleCap(c: RuntimeKind) {
    setCaps((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  }

  function changeKind(next: ProviderKind) {
    setKind(next);
    if (next !== 'docker') setRoutingMode('direct-port');
    if (!editing) setCaps(defaultCapabilities(next));
  }

  function changeHost(next: string) {
    if (next.trim() !== host.trim()) setHostKeyFingerprint('');
    setHost(next);
  }

  function changePort(next: string) {
    if (next !== port) setHostKeyFingerprint('');
    setPort(next);
  }

  async function inspectHostKey() {
    const inspectedHost = host.trim();
    const inspectedPort = Number(port);
    if (
      !inspectedHost ||
      !Number.isInteger(inspectedPort) ||
      inspectedPort < 1 ||
      inspectedPort > 65535
    ) {
      toast.error('Enter a valid server host and port first');
      return;
    }

    setInspectingHostKey(true);
    try {
      const identity = await api.inspectTargetHostKey({ host: inspectedHost, port: inspectedPort });
      if (inspectedHost !== host.trim() || inspectedPort !== Number(port)) {
        toast.error('The server address changed during host-key inspection. Try again.');
        return;
      }

      const previousFingerprint = hostKeyFingerprint || target?.hostKeyFingerprint || null;
      if (
        previousFingerprint &&
        normalizeHostKeyFingerprint(previousFingerprint) ===
          normalizeHostKeyFingerprint(identity.fingerprint)
      ) {
        setHostKeyFingerprint(identity.fingerprint);
        toast.success('The server identity matches the trusted fingerprint');
        return;
      }

      const replacingIdentity = Boolean(previousFingerprint);
      const confirmed = await confirmAction({
        title: replacingIdentity
          ? 'The server identity has changed'
          : 'Trust this server identity?',
        description: replacingIdentity
          ? 'A changed SSH host key can mean that the server was reinstalled, its key was rotated, or the connection is being intercepted.'
          : 'Compare this fingerprint with the value provided by the server administrator before trusting it.',
        confirmLabel: replacingIdentity ? 'Replace trusted key' : 'Trust and save',
        tone: replacingIdentity ? 'danger' : 'warning',
        details: [
          { label: 'Server', value: `${identity.host}:${identity.port}` },
          { label: 'Key type', value: identity.algorithm },
          ...(previousFingerprint
            ? [{ label: 'Previously trusted', value: previousFingerprint }]
            : []),
          {
            label: replacingIdentity ? 'New fingerprint' : 'Fingerprint',
            value: identity.fingerprint,
          },
        ],
        consequences: [
          'InitPad will pin this exact key for every future SFTP connection.',
          'A different key will stop the connection before any credential is sent.',
        ],
      });
      if (confirmed) setHostKeyFingerprint(identity.fingerprint);
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setInspectingHostKey(false);
    }
  }

  const valid =
    name.trim() &&
    publicUrl.trim() &&
    (kind !== 'docker' ||
      routingMode === 'direct-port' ||
      validManagedGatewayOrigin(publicUrl.trim())) &&
    caps.length > 0 &&
    (kind === 'docker' ||
      (host.trim() &&
        username.trim() &&
        remotePath.trim() &&
        /^SHA256:[A-Za-z0-9+/]{43}=?$/.test(hostKeyFingerprint.trim()) &&
        ((editing && !requiresReconnectCredential) || secret.trim())));

  function submit() {
    const common = {
      name: name.trim(),
      kind,
      capabilities: caps,
      publicUrl: publicUrl.trim(),
    };
    onSubmit(
      kind === 'docker'
        ? { ...common, routingMode }
        : {
            ...common,
            host: host.trim(),
            port: Number(port) || 22,
            username: username.trim(),
            auth,
            secret: secret.trim() || undefined,
            hostKeyFingerprint: hostKeyFingerprint.trim(),
            remotePath: remotePath.trim(),
          },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Server className="h-[18px] w-[18px]" />{' '}
            {editing ? 'Edit server' : 'Add deployment server'}
          </DialogTitle>
          <DialogDescription>
            {kind === 'docker'
              ? 'Recommended for application workloads. The server connects outbound through InitPad Agent; no inbound SSH credential is stored.'
              : 'Compatibility option for shared PHP or static hosting. Connection credentials are encrypted at rest.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">
          {requiresReconnectCredential && (
            <Notice tone="warning" title="A new credential is required" className="sm:col-span-2">
              The previous credential was permanently removed. Save a replacement, then run Test
              connection to resume InitPad management.
            </Notice>
          )}
          <div className={cn(FIELD, 'sm:col-span-2')}>
            <FieldLabel htmlFor="t-name">Name</FieldLabel>
            <Input
              id="t-name"
              value={name}
              placeholder="ESO school server"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className={FIELD}>
            <FieldLabel htmlFor="t-kind">Connection method</FieldLabel>
            <Select
              id="t-kind"
              value={kind}
              disabled={editing}
              onChange={(e) => changeKind(e.target.value as ProviderKind)}
            >
              <option value="docker">InitPad Agent for Docker (recommended)</option>
              <option value="sftp">SFTP shared web hosting</option>
            </Select>
          </div>
          {kind !== 'docker' && (
            <div className={FIELD}>
              <FieldLabel htmlFor="t-port">Port</FieldLabel>
              <Input
                id="t-port"
                value={port}
                onChange={(e) => changePort(e.target.value)}
                inputMode="numeric"
              />
            </div>
          )}
          {kind === 'docker' && (
            <div className={FIELD}>
              <FieldLabel htmlFor="t-routing">Application exposure</FieldLabel>
              <Select
                id="t-routing"
                value={routingMode}
                onChange={(e) => setRoutingMode(e.target.value as TargetRoutingMode)}
              >
                <option value="direct-port">Direct ports (local / lab)</option>
                <option value="managed-gateway">Managed gateway (production)</option>
              </Select>
            </div>
          )}

          <div className={cn(FIELD, 'sm:col-span-2')}>
            <FieldLabel
              help={
                <InfoTip label="About supported runtimes">
                  {kind === 'sftp'
                    ? 'Static sites need SFTP only. PHP enables Nette, Laravel and Symfony and also requires shell access through the same account for isolated, removable releases.'
                    : kind === 'docker'
                      ? 'The Agent confirms Docker support after enrollment. Deployment stays disabled until the delivery path is ready.'
                      : 'Choose only runtimes installed on this server. Test connection reports the detected command-line runtimes.'}
                </InfoTip>
              }
            >
              Can run
            </FieldLabel>
            <div className="flex flex-wrap gap-2">
              {ALL_CAPS.map((c) => (
                <ChoiceChip
                  key={c.id}
                  selected={caps.includes(c.id)}
                  onToggle={() => toggleCap(c.id)}
                >
                  {c.label}
                </ChoiceChip>
              ))}
            </div>
          </div>

          {kind !== 'docker' && (
            <>
              <div className={cn(FIELD, 'sm:col-span-2')}>
                <FieldLabel htmlFor="t-host">Host</FieldLabel>
                <Input
                  id="t-host"
                  value={host}
                  placeholder="eso.example.edu"
                  onChange={(e) => changeHost(e.target.value)}
                />
              </div>
              <div className={FIELD}>
                <FieldLabel htmlFor="t-user">Username</FieldLabel>
                <Input id="t-user" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className={FIELD}>
                <FieldLabel htmlFor="t-auth">Auth</FieldLabel>
                <Select
                  id="t-auth"
                  value={auth}
                  onChange={(e) => setAuth(e.target.value as 'password' | 'key')}
                >
                  <option value="password">Password</option>
                  <option value="key">SSH key</option>
                </Select>
              </div>
              <div className={cn(FIELD, 'sm:col-span-2')}>
                <FieldLabel htmlFor="t-secret">
                  {auth === 'key' ? 'Private key (PEM)' : 'Password'}
                </FieldLabel>
                {auth === 'key' ? (
                  <textarea
                    id="t-secret"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={
                      requiresReconnectCredential
                        ? 'Paste the replacement OpenSSH private key'
                        : editing
                          ? 'Leave blank to keep the existing key'
                          : 'Paste an OpenSSH private key'
                    }
                    className={cn(fieldClassName, 'min-h-[96px] px-3 py-2 font-mono sm:text-xs')}
                  />
                ) : (
                  <Input
                    id="t-secret"
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={
                      requiresReconnectCredential
                        ? 'Enter a new password'
                        : editing
                          ? 'Leave blank to keep the existing password'
                          : ''
                    }
                  />
                )}
              </div>
              <div className={cn(FIELD, 'sm:col-span-2')}>
                <div className="flex min-h-7 items-center gap-1">
                  <Label htmlFor="t-host-key">Host key fingerprint</Label>
                  <InfoTip label="How to verify the server identity">
                    <span className="block">
                      <strong>Trusted source:</strong> compare the value with the server
                      administrator.
                    </span>
                    <span className="mt-2 block">
                      <strong>Inspect:</strong>
                    </span>
                    <code className="mt-1 block break-all text-xs">
                      ssh-keyscan -p {Number(port) || 22} {host || 'host'} 2&gt;/dev/null |
                      ssh-keygen -lf - -E sha256
                    </code>
                    <span className="mt-2 block">
                      Do not trust the first scan alone on an untrusted network.
                    </span>
                  </InfoTip>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="t-host-key"
                    value={hostKeyFingerprint}
                    placeholder="Not trusted yet"
                    spellCheck={false}
                    readOnly
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || inspectingHostKey || !host.trim()}
                    onClick={() => void inspectHostKey()}
                  >
                    {inspectingHostKey ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <ScanSearch className="h-4 w-4" />
                    )}
                    {hostKeyFingerprint ? 'Check identity' : 'Get fingerprint'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  InitPad retrieves the public key without sending the password or private key. You
                  must confirm it before the connection is saved.
                </p>
              </div>
              <div className={cn(FIELD, 'sm:col-span-2')}>
                <FieldLabel htmlFor="t-path">Remote path</FieldLabel>
                <Input
                  id="t-path"
                  value={remotePath}
                  placeholder="/www/myapp"
                  onChange={(e) => setRemotePath(e.target.value)}
                />
              </div>
            </>
          )}
          <div className={cn(FIELD, 'sm:col-span-2')}>
            <div className="flex min-h-7 items-center gap-1">
              <Label htmlFor="t-url">
                {kind === 'docker' && routingMode === 'managed-gateway'
                  ? 'Gateway base URL'
                  : kind === 'docker'
                    ? 'Application base URL'
                    : 'Public URL'}
              </Label>
              {kind === 'docker' && (
                <InfoTip label="About the application address">
                  {routingMode === 'managed-gateway'
                    ? 'Use an HTTPS DNS origin for stable application hostnames. Run gateway preflight before the first deployment.'
                    : 'Use the browser-reachable address of this server. Each local or lab application receives its own published port.'}
                </InfoTip>
              )}
            </div>
            <Input
              id="t-url"
              value={publicUrl}
              placeholder={
                kind === 'docker'
                  ? routingMode === 'managed-gateway'
                    ? 'https://apps.example.cz'
                    : 'http://192.168.1.50'
                  : 'https://eso.example.edu/~user'
              }
              onChange={(e) => setPublicUrl(e.target.value)}
              aria-invalid={
                kind === 'docker' &&
                routingMode === 'managed-gateway' &&
                publicUrl.length > 0 &&
                !validManagedGatewayOrigin(publicUrl.trim())
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            disabled={busy || inspectingHostKey}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={busy || inspectingHostKey || !valid} onClick={submit}>
            {busy && <Spinner className="h-4 w-4" />}
            {reconnectingRemote ? 'Save connection' : editing ? 'Save server' : 'Add server'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
