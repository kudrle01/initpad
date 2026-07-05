import { NavLink } from 'react-router-dom';
import {
  Activity,
  ChevronsUpDown,
  LayoutDashboard,
  Layers,
  FolderClosed,
  LogOut,
  Plus,
  Server,
  Network,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { User } from '@/types';

function initials(name: string) {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: Layers },
  { to: '/templates', label: 'Templates', icon: FolderClosed },
  { to: '/new', label: 'New project', icon: Plus },
];

const PLATFORM_NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/environments', label: 'Environments', icon: Server },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/infrastructure', label: 'Infrastructure', icon: Network },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function itemClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center justify-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors lg:justify-start',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
    isActive
      ? 'bg-secondary text-foreground'
      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
  );
}

function Item({ to, label, icon: I, end }: { to: string; label: string; icon: LucideIcon; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={itemClass} title={label}>
      {({ isActive }) => (
        <>
          <I className={cn('h-[18px] w-[18px] shrink-0', isActive && 'text-primary')} />
          <span className="hidden lg:inline">{label}</span>
        </>
      )}
    </NavLink>
  );
}

// Organism: application navigation. Collapses to an icon rail on narrow
// viewports; full width with labels from the lg breakpoint up.
export function Sidebar({ user, onLogout }: { user: User; onLogout: () => void }) {
  const display = user.name || user.username;
  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-16 flex-col border-r border-border bg-card lg:w-60">
      <div className="flex items-center justify-center gap-2 px-3 py-5 lg:justify-start lg:px-5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          IP
        </span>
        <span className="hidden text-[15px] font-semibold tracking-tight lg:inline">InitPad</span>
        <span className="hidden rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground lg:inline">
          beta
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {NAV.map((item) => (
          <Item key={item.to} {...item} />
        ))}

        <div className="mx-2 my-3 h-px bg-border lg:hidden" />
        <div className="hidden px-2.5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 lg:block">
          Platform
        </div>
        {PLATFORM_NAV.map((item) => (
          <Item key={item.to} {...item} />
        ))}
      </nav>

      <div className="border-t border-border p-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 lg:justify-start"
              title={display}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
                {initials(display)}
              </span>
              <span className="hidden min-w-0 flex-1 lg:block">
                <span className="block truncate text-sm font-medium">{display}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  @{user.username}
                </span>
              </span>
              <ChevronsUpDown className="hidden h-4 w-4 shrink-0 text-muted-foreground lg:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52">
            <DropdownMenuLabel>Signed in as @{user.username}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut className="h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
