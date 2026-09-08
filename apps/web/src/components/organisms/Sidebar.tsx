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
import { CreateWorkspaceDialog } from '@/components/organisms/CreateWorkspaceDialog';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function initials(name: string) {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: Layers },
  { to: '/environments', label: 'Deployments', icon: Server },
  { to: '/infrastructure', label: 'Servers', icon: Network },
];

const MANAGE_NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/templates', label: 'Project templates', icon: FolderClosed },
  { to: '/activity', label: 'Development activity', icon: Activity },
  { to: '/audit', label: 'Audit log', icon: ScrollText },
  { to: '/settings/workspace', label: 'Workspace', icon: Building2 },
];

function itemClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
    isActive
      ? 'bg-secondary text-foreground'
      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
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
  label: string;
  icon: LucideIcon;
  end?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink to={to} end={end} className={itemClass} onClick={onNavigate}>
      {({ isActive }) => (
        <>
          <Icon className={cn('h-[18px] w-[18px] shrink-0', isActive && 'text-primary')} />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
        IP
      </span>
      <span className="text-[15px] font-semibold tracking-tight">InitPad</span>
      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        beta
      </span>
    </div>
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
            'flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-3 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            compact ? 'min-w-0 max-w-[calc(100vw-8rem)]' : 'w-full',
          )}
          title={activeWorkspace?.name ?? 'Workspace'}
          aria-label={`Workspace: ${activeWorkspace?.name ?? 'none'}`}
        >
          <Building2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">
              {activeWorkspace?.name ?? 'Workspace'}
            </span>
            {!compact && (
              <span className="block truncate text-[10px] text-muted-foreground">
                {activeWorkspace?.role ?? 'loading'}
              </span>
            )}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(16rem,calc(100vw-1.5rem))]">
        <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onSelect={() => switchWorkspace(workspace.id)}>
            <Building2 className="h-4 w-4" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{workspace.name}</span>
              <span className="block text-xs text-muted-foreground">
                {workspace.type} · {workspace.role}
              </span>
            </span>
            {workspace.id === activeWorkspace?.id && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreate}>
          <Plus className="h-4 w-4" />
          <span>Add new workspace</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Navigation({ user, onNavigate }: { user: User; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
      {NAV.map((item) => (
        <Item key={item.to} {...item} onNavigate={onNavigate} />
      ))}

      <div className="px-3 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        Manage
      </div>
      {MANAGE_NAV.map((item) => (
        <Item key={item.to} {...item} onNavigate={onNavigate} />
      ))}
      {user.edition === 'self-hosted' && user.platformRole === 'admin' && (
        <Item
          to="/admin"
          label="Instance"
          icon={ShieldCheck}
          onNavigate={onNavigate}
        />
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
          className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          title={display}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
            {initials(display)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{display}</span>
            <span className="block truncate text-xs text-muted-foreground">@{user.username}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-52">
        <DropdownMenuLabel>Signed in as @{user.username}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings/account" onClick={onNavigate}>
            <UserRound className="h-4 w-4" /> Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut className="h-4 w-4" /> Sign out
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
      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur lg:hidden">
        <div className="mr-auto flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            IP
          </span>
          <span className="hidden font-semibold tracking-tight sm:inline">InitPad</span>
        </div>
        <WorkspaceMenu compact onCreate={openCreateWorkspace} />
        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
          </DialogTrigger>
          <DialogContent
            className="left-0 top-0 flex h-dvh max-h-none w-[min(20rem,88vw)] max-w-none -translate-x-0 -translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-y-0 border-l-0 p-0"
            aria-describedby={undefined}
          >
            <DialogTitle className="sr-only">Navigation</DialogTitle>
            <div className="px-5 py-4">
              <Brand />
            </div>
            <div className="px-3 pb-3">
              <WorkspaceMenu onCreate={openCreateWorkspace} />
            </div>
            <Navigation user={user} onNavigate={() => setMobileOpen(false)} />
            <div className="border-t border-border p-3">
              <UserMenu
                user={user}
                onLogout={onLogout}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </DialogContent>
        </Dialog>
      </header>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-card lg:flex">
        <div className="px-5 py-5">
          <Brand />
        </div>
        <div className="px-3 pb-3">
          <WorkspaceMenu onCreate={openCreateWorkspace} />
        </div>
        <Navigation user={user} />
        <div className="border-t border-border p-3">
          <UserMenu user={user} onLogout={onLogout} />
        </div>
      </aside>

      <CreateWorkspaceDialog
        open={createWorkspaceOpen}
        onOpenChange={setCreateWorkspaceOpen}
      />
    </>
  );
}
