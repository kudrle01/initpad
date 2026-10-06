import { Check, Languages } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { useLocale } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import { t, setLocale, LOCALES } from '@/i18n';

/** Language choices for an account menu. Each language is named in itself. */
export function LanguageMenuItems() {
  const locale = useLocale();
  return (
    <>
      <DropdownMenuLabel>{t('Language')}</DropdownMenuLabel>
      {LOCALES.map(({ value, label }) => (
        <DropdownMenuItem key={value} lang={value} onSelect={() => setLocale(value)}>
          <Languages className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">{label}</span>
          {locale === value && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** Compact EN / CZ switch for screens without an account menu (sign-in). */
export function LanguageToggle({ className }: { className?: string }) {
  const locale = useLocale();
  return (
    <div
      role="group"
      aria-label={t('Language')}
      className={cn('inline-flex gap-0.5 rounded-full bg-foreground/[0.06] p-1', className)}
    >
      {LOCALES.map(({ value, label, short }) => {
        const active = locale === value;
        return (
          <button
            key={value}
            type="button"
            lang={value}
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={() => setLocale(value)}
            className={cn(
              'h-9 min-w-10 rounded-full px-2.5 text-xs font-semibold transition-colors sm:h-7',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              active
                ? 'bg-card text-foreground shadow-xs dark:bg-foreground/15'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {short}
          </button>
        );
      })}
    </div>
  );
}
