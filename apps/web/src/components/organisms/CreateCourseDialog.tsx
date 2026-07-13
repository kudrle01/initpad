import { useEffect, useState, type FormEvent } from 'react';
import { GraduationCap } from 'lucide-react';
import { api } from '@/api';
import { useToast } from '@/toast';
import { Spinner } from '@/components/atoms/Spinner';
import { CopyField } from '@/components/molecules/CopyField';
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
  onCreated: () => void;
}

function slugify(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 33);
}

export function CreateCourseDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [enrollmentCode, setEnrollmentCode] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setName('');
    setSlug('');
    setSlugEdited(false);
    setDescription('');
    setBusy(false);
    setEnrollmentCode(null);
  }, [open]);

  const valid = name.trim().length >= 2 && /^[a-z][a-z0-9-]{1,31}[a-z0-9]$/.test(slug);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const created = await api.createCourse(name.trim(), slug, description.trim() || undefined);
      setEnrollmentCode(created.enrollmentCode);
      onCreated();
      toast.success('Course created');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        {enrollmentCode ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle><GraduationCap className="h-[18px] w-[18px]" /> Course created</DialogTitle>
              <DialogDescription>
                Copy this enrollment code now. InitPad stores only its hash, so it cannot be shown again.
              </DialogDescription>
            </DialogHeader>
            <CopyField command={enrollmentCode} />
            <p className="text-xs text-muted-foreground">
              Rotating the code later immediately invalidates this one.
            </p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle><GraduationCap className="h-[18px] w-[18px]" /> Create course</DialogTitle>
              <DialogDescription>
                A private instructor workspace and a one-time student enrollment code are created with it.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="course-name">Course name</Label>
                <Input id="course-name" autoFocus maxLength={100} placeholder="DevOps Lab"
                  value={name} onChange={(event) => {
                    setName(event.target.value);
                    if (!slugEdited) setSlug(slugify(event.target.value));
                  }} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="course-slug">Course slug</Label>
                <Input id="course-slug" maxLength={33} placeholder="devops-lab" spellCheck={false}
                  value={slug} onChange={(event) => {
                    setSlugEdited(true);
                    setSlug(event.target.value.toLowerCase());
                  }} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="course-description">Description <span className="text-muted-foreground">(optional)</span></Label>
                <textarea id="course-description" maxLength={500} rows={3}
                  className="rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  placeholder="What students will build and learn" value={description}
                  onChange={(event) => setDescription(event.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={!valid || busy}>
                {busy && <Spinner className="h-4 w-4" />}{busy ? 'Creating…' : 'Create course'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
