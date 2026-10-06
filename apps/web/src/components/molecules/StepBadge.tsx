/** Numbered marker for the sections of a guided form. */
export function StepBadge({ step }: { step: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
    >
      {step}
    </span>
  );
}
