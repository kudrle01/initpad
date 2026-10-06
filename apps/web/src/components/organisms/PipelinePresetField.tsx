import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PIPELINE_PRESET_OPTIONS } from '@/lib/pipeline-presets';
import type { PipelinePreset } from '@/types';

interface Props {
  value: PipelinePreset;
  onChange: (value: PipelinePreset) => void;
  disabled?: boolean;
  /** The surrounding section already carries the visible "Pipeline" heading. */
  hideLegend?: boolean;
}

export function PipelinePresetField({
  value,
  onChange,
  disabled = false,
  hideLegend = false,
}: Props) {
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className={hideLegend ? 'sr-only' : 'mb-2 text-sm font-medium'}>Pipeline</legend>
      {/* auto-fit: three across in a wide form, stacked in a narrow column. */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11.5rem),1fr))]">
        {PIPELINE_PRESET_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                'relative min-w-0 cursor-pointer rounded-lg border p-4 transition-colors',
                'focus-within:ring-2 focus-within:ring-ring/40',
                selected
                  ? 'border-primary/60 bg-secondary/60'
                  : 'border-border bg-card hover:border-input hover:bg-muted/50',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name="pipeline-preset"
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span className="flex items-start justify-between gap-2 text-sm font-medium">
                <span className="min-w-0">{option.label}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-card',
                  )}
                >
                  {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
              </span>
              <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
                {option.description}
              </span>
              <span className="mt-3 block font-mono text-[11px] font-medium uppercase tracking-wide text-primary">
                {option.stages.join(' → ')}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
