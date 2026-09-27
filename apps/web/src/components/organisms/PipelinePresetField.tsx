import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PIPELINE_PRESET_OPTIONS } from '@/lib/pipeline-presets';
import type { PipelinePreset } from '@/types';

interface Props {
  value: PipelinePreset;
  onChange: (value: PipelinePreset) => void;
  disabled?: boolean;
}

export function PipelinePresetField({ value, onChange, disabled = false }: Props) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-xs font-medium text-muted-foreground">Pipeline</legend>
      <div className="grid max-w-3xl gap-2 md:grid-cols-3">
        {PIPELINE_PRESET_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                'relative cursor-pointer rounded-lg border bg-card p-3 transition-colors',
                'focus-within:ring-2 focus-within:ring-ring/40',
                selected ? 'border-primary ring-1 ring-primary/20' : 'border-border',
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
                {option.label}
                {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>
              <span className="mt-2 block font-mono text-[11px] uppercase text-primary">
                {option.stages.join(' → ')}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
