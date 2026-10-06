import { Check, Monitor, Moon, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { useTheme, type ThemePreference } from '@/theme';
import { cn } from '@/lib/utils';
import { t, msg, type MessageKey } from '@/i18n';

const OPTIONS: { value: ThemePreference; label: MessageKey; icon: LucideIcon }[] = [
  { value: 'light', label: msg('Light'), icon: Sun },
  { value: 'dark', label: msg('Dark'), icon: Moon },
  { value: 'system', label: msg('System'), icon: Monitor },
];

/** Appearance choices for an account menu. */
export function ThemeMenuItems() {
  const { preference, setPreference } = useTheme();
  return (
    <>
      <DropdownMenuLabel>{t('Appearance')}</DropdownMenuLabel>
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
          <span className="flex-1">{t(label)}</span>
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
  const label = next === 'dark' ? t('Switch to dark theme') : t('Switch to light theme');
  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-9 sm:w-9',
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
