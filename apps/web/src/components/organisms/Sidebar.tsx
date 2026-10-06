import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  Activity,
  Building2,
  Check,
  ChevronsUpDown,
  FolderClosed,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  Plus,
  Server,
  ShieldCheck,
  ScrollText,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/auth';
import { cn } from '@/lib/utils';
import type { User } from '@/types';
import { BrandMark } from '@/components/atoms/BrandMark';
import { LanguageMenuItems } from '@/components/molecules/LanguageSwitch';
import { ThemeMenuItems } from '@/components/molecules/ThemeToggle';
import { CreateWorkspaceDialog } from '@/components/organisms/CreateWorkspaceDialog';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { t, msg, type MessageKey } from '@/i18n';
import { roleLabel, termLabel } from '@/i18n/labels';

function initials(name: string) {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

const NAV: { to: string; label: MessageKey; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: msg('Overview'), icon: LayoutDashboard, end: true },
  { to: '/projects', label: msg('Projects'), icon: Layers },
  { to: '/environments', label: msg('Deployments'), icon: Server },
  { to: '/infrastructure', label: msg('Servers'), icon: Network },
];

const MANAGE_NAV: { to: string; label: MessageKey; icon: LucideIcon }[] = [
  { to: '/templates', label: msg('Project templates'), icon: FolderClosed },
  { to: '/activity', label: msg('Development activity'), icon: Activity },
  { to: '/audit', label: msg('Audit log'), icon: ScrollText },
  { to: '/settings/workspace', label: msg('Workspace'), icon: Building2 },
];

function itemClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors lg:min-h-10',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
    isActive
      ? 'bg-secondary text-secondary-foreground'
      : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
  );
}

function Item({
  to,
  label,
  icon: Icon,
  end,
  onNavigate,
}: {
  to: string;
  label: MessageKey;
  icon: LucideIcon;
  end?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink to={to} end={end} className={itemClass} onClick={onNavigate}>
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{t(label)}</span>
    </NavLink>
  );
}

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      to="/"
      onClick={onNavigate}
      className="flex w-fit items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      aria-label={t('InitPad overview')}
    >
      <BrandMark className="h-8 w-8" />
      <span className="text-lg font-semibold tracking-tight">InitPad</span>
      <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium leading-4 text-secondary-foreground">
        {t('beta')}
      </span>
    </Link>
  );
}

function WorkspaceMenu({ compact, onCreate }: { compact?: boolean; onCreate: () => void }) {
  const { workspaces, activeWorkspace, switchWorkspace } = useAuth();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-2.5 rounded-lg border border-border bg-muted/60 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            compact ? 'min-h-11 min-w-0 max-w-[calc(100vw-8.5rem)] px-2.5' : 'w-full p-2',
          )}
          title={activeWorkspace?.name ?? t('Workspace')}
          aria-label={t('Workspace: {name}', { name: activeWorkspace?.name ?? t('none') })}
        >
          <span
            className={cn(
              'flex shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground',
              compact ? 'h-7 w-7' : 'h-9 w-9',
            )}
          >
            <Building2 className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-5">
              {activeWorkspace?.name ?? t('Workspace')}
            </span>
            {!compact && (
              <span className="block truncate text-xs capitalize leading-4 text-muted-foreground">
                {activeWorkspace ? roleLabel(activeWorkspace.role) : t('loading')}
              </span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(28rem,calc(100dvh-6rem))] w-[min(17rem,calc(100vw-1.5rem))] overflow-y-auto"
      >
        <DropdownMenuLabel>{t('Switch workspace')}</DropdownMenuLabel>
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onSelect={() => switchWorkspace(workspace.id)}
            title={workspace.name}
          >
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{workspace.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {termLabel(workspace.type)} · {roleLabel(workspace.role)}
              </span>
            </span>
            {workspace.id === activeWorkspace?.id && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreate}>
          <Plus className="h-4 w-4 text-muted-foreground" />
          <span>{t('Add new workspace')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Navigation({ user, onNavigate }: { user: User; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
      {NAV.map((item) => (
        <Item key={item.to} {...item} onNavigate={onNavigate} />
      ))}

      <div className="px-3 pb-1 pt-5 text-xs font-medium text-muted-foreground/80">
        {t('Manage')}
      </div>
      {MANAGE_NAV.map((item) => (
        <Item key={item.to} {...item} onNavigate={onNavigate} />
      ))}
      {user.platformRole === 'admin' && (
        <Item to="/admin" label={msg('Platform')} icon={ShieldCheck} onNavigate={onNavigate} />
      )}
    </nav>
  );
}

function UserMenu({
  user,
  onLogout,
  onNavigate,
}: {
  user: User;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  const display = user.name || user.username;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-h-12 w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          title={display}
          data-language-control
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials(display)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-5">{display}</span>
            <span className="block truncate text-xs leading-4 text-muted-foreground">
              @{user.username}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-[min(15rem,calc(100vw-1.5rem))]">
        <DropdownMenuLabel className="truncate">
          {t('Signed in as @{username}', { username: user.username })}
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/settings/account" onClick={onNavigate}>
            <UserRound className="h-4 w-4 text-muted-foreground" /> {t('Account settings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ThemeMenuItems />
        <DropdownMenuSeparator />
        <LanguageMenuItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut className="h-4 w-4 text-muted-foreground" /> {t('Sign out')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Desktop uses a stable sidebar; mobile gets a full-width header and an
// accessible navigation drawer so content keeps the entire narrow viewport.
export function Sidebar({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  function openCreateWorkspace() {
    setMobileOpen(false);
    setCreateWorkspaceOpen(true);
  }

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-2 border-b border-border/70 bg-sidebar/90 px-3 backdrop-blur-md sm:px-4 lg:hidden">
        <Link
          to="/"
          aria-label={t('InitPad overview')}
          className="mr-auto flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <BrandMark className="h-8 w-8" />
          <span className="hidden text-lg font-semibold tracking-tight sm:inline">InitPad</span>
        </Link>
        <WorkspaceMenu compact onCreate={openCreateWorkspace} />
        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label={t('Open navigation')}
              // The drawer that holds the language menu closes on a switch.
              data-language-control
            >
              <Menu className="h-5 w-5" />
            </button>
          </DialogTrigger>
          <DialogContent
            className="left-0 top-0 flex h-dvh max-h-none w-[min(20rem,88vw)] max-w-none -translate-x-0 -translate-y-0 flex-col gap-0 overflow-hidden rounded-none rounded-r-xl border-y-0 border-l-0 bg-sidebar p-0 sm:w-[min(20rem,88vw)] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-h-none sm:p-0"
            aria-describedby={undefined}
          >
            <DialogTitle className="sr-only">{t('Navigation')}</DialogTitle>
            <div className="px-5 pb-4 pt-5">
              <Brand onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="px-3 pb-4">
              <WorkspaceMenu onCreate={openCreateWorkspace} />
            </div>
            <Navigation user={user} onNavigate={() => setMobileOpen(false)} />
            <div className="border-t border-border/70 p-2">
              <UserMenu user={user} onLogout={onLogout} onNavigate={() => setMobileOpen(false)} />
            </div>
          </DialogContent>
        </Dialog>
      </header>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border/70 bg-sidebar lg:flex">
        <div className="px-5 pb-5 pt-6">
          <Brand />
        </div>
        <div className="px-3 pb-4">
          <WorkspaceMenu onCreate={openCreateWorkspace} />
        </div>
        <Navigation user={user} />
        <div className="border-t border-border/70 p-2">
          <UserMenu user={user} onLogout={onLogout} />
        </div>
      </aside>

      <CreateWorkspaceDialog open={createWorkspaceOpen} onOpenChange={setCreateWorkspaceOpen} />
    </>
  );
}
