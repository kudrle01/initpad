import { Spinner } from '@/components/atoms/Spinner';

export function RouteLoading() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center gap-3 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Spinner className="h-5 w-5" />
      <span>Loading page…</span>
    </div>
  );
}
