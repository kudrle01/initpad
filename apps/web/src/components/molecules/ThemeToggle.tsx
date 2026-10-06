import { Check, Monitor, Moon, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { useTheme, type ThemePreference } from '@/theme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** Appearance choices for an account menu. */
export function ThemeMenuItems() {
  const { preference, setPreference } = useTheme();
  return (
    <>
      <DropdownMenuLabel>Appearance</DropdownMenuLabel>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <DropdownMenuItem
          key={value}
          // Keep the menu open so the result of the switch is visible.
          onSelect={(event) => {
            event.preventDefault();
            setPreference(value);
          }}
        >
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">{label}</span>
          {preference === value && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** One-tap light/dark switch for screens without an account menu (sign-in). */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setPreference } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  const Icon = resolved === 'dark' ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-9 sm:w-9',
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
