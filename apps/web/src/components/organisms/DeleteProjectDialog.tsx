import { useState } from 'react';
import { Trash2 } from 'lucide-react';
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
import { Spinner } from '@/components/atoms/Spinner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  deleting: boolean;
  onConfirm: () => void;
}

export function DeleteProjectDialog({ open, onOpenChange, projectName, deleting, onConfirm }: Props) {
  const [text, setText] = useState('');
  const match = text === projectName;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!deleting) {
          setText('');
          onOpenChange(o);
        }
      }}
    >
      <DialogContent hideClose>
        <DialogHeader>
          <DialogTitle>
            <Trash2 className="h-[18px] w-[18px] text-destructive" /> Delete project
          </DialogTitle>
          <DialogDescription>
            This permanently stops and removes all containers and images, deletes the Git
            repository in Gitea, and removes the project. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Type <strong className="font-semibold">{projectName}</strong> to confirm:
          </p>
          <Input
            value={text}
            autoFocus
            placeholder={projectName}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && match) onConfirm();
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={!match || deleting}>
            {deleting ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
            {deleting ? 'deleting…' : 'Delete project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
