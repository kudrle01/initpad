import { useEffect, useState, type FormEvent } from 'react';
import { Users } from 'lucide-react';
import { api } from '@/api';
import { useToast } from '@/toast';
import { Spinner } from '@/components/atoms/Spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

function slugify(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function CreateCourseTeamDialog({ courseId, open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setName(''); setSlug(''); setSlugEdited(false); setBusy(false);
  }, [open]);

  const valid = name.trim().length >= 2 && /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(slug);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await api.createCourseTeam(courseId, name.trim(), slug);
      onCreated();
      onOpenChange(false);
      toast.success('Team created');
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
            <DialogTitle><Users className="h-[18px] w-[18px]" /> Create student team</DialogTitle>
            <DialogDescription>
              The team gets its own workspace. Projects and permissions remain isolated from other teams.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="team-name">Team name</Label>
              <Input id="team-name" autoFocus maxLength={80} placeholder="Team Green"
                value={name} onChange={(event) => {
                  setName(event.target.value);
                  if (!slugEdited) setSlug(slugify(event.target.value));
                }} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="team-slug">Team slug</Label>
              <Input id="team-slug" maxLength={40} placeholder="team-green" spellCheck={false}
                value={slug} onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(event.target.value.toLowerCase());
                }} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || busy}>
              {busy && <Spinner className="h-4 w-4" />}{busy ? 'Creating…' : 'Create team'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
