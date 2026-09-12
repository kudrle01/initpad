import { useEffect, useState, type FormEvent } from 'react';
import { Building2 } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { useToast } from '@/toast';
import { Spinner } from '@/components/atoms/Spinner';
import { InfoTip } from '@/components/molecules/InfoTip';
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function CreateWorkspaceDialog({ open, onOpenChange }: Props) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const { switchWorkspace } = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setName('');
    setSlug('');
    setSlugEdited(false);
    setBusy(false);
  }, [open]);

  const nameValid = name.trim().length >= 2 && name.trim().length <= 80;
  const slugValid = /^(?!personal-)[a-z][a-z0-9-]{1,39}$/.test(slug);

  function changeName(value: string) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!nameValid || !slugValid || busy) return;
    setBusy(true);
    try {
      const created = await api.createWorkspace(name.trim(), slug);
      onOpenChange(false);
      switchWorkspace(created.id);
    } catch (error) {
      toast.error((error as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              <Building2 className="h-[18px] w-[18px]" /> Add new workspace
            </DialogTitle>
            <DialogDescription>
              Create a shared space for a team. You will become its owner and can invite members
              afterwards.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                autoFocus
                maxLength={80}
                placeholder="Platform team"
                value={name}
                onChange={(event) => changeName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="workspace-slug">Workspace slug</Label>
                <InfoTip label="About the workspace slug">
                  A stable identifier used in namespaces and URLs. Use lowercase letters, numbers
                  and hyphens.
                </InfoTip>
              </div>
              <Input
                id="workspace-slug"
                maxLength={40}
                spellCheck={false}
                autoComplete="off"
                placeholder="platform-team"
                value={slug}
                aria-invalid={slug.length > 0 && !slugValid ? true : undefined}
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(event.target.value.toLowerCase());
                }}
              />
              {slug.length > 0 && !slugValid && (
                <p className="text-xs text-destructive">
                  Use 2–40 characters, start with a letter and avoid the reserved personal- prefix.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !nameValid || !slugValid}>
              {busy && <Spinner className="h-4 w-4" />}
              {busy ? 'Creating…' : 'Create workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
