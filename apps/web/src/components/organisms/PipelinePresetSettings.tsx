import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/molecules/Notice';
import { PipelinePresetField } from './PipelinePresetField';
import {
  EnvironmentTargetFields,
  suggestedEnvironmentTargets,
  type EnvironmentTargets,
} from './EnvironmentTargetFields';
import { pipelineStages } from '@/lib/pipeline-presets';
import type { EnvName, PipelinePreset, Project, Target, TemplateManifest } from '@/types';
import { t } from '@/i18n';

interface Props {
  project: Project;
  template: TemplateManifest | null;
  targets: Target[];
  hosted: boolean;
  canMaintain: boolean;
  busy: boolean;
  onSave: (preset: PipelinePreset, targets: Array<{ name: EnvName; targetId?: string }>) => void;
}

export function PipelinePresetSettings({
  project,
  template,
  targets,
  hosted,
  canMaintain,
  busy,
  onSave,
}: Props) {
  const [selected, setSelected] = useState(project.pipelinePreset);
  const [environmentTargets, setEnvironmentTargets] = useState<EnvironmentTargets>({
    dev: '',
    test: '',
    prod: '',
  });

  useEffect(() => {
    // Project detail polls in the background. Do not overwrite a maintainer's
    // in-progress preset and target selection with an equivalent fresh object.
    if (selected !== project.pipelinePreset) return;
    setSelected(project.pipelinePreset);
    const suggestions = suggestedEnvironmentTargets(template, targets, hosted);
    setEnvironmentTargets({
      ...suggestions,
      ...Object.fromEntries(
        project.environments.map((environment) => [environment.name, environment.target?.id ?? '']),
      ),
    });
  }, [hosted, project.environments, project.pipelinePreset, selected, targets, template]);

  const currentStages = useMemo(
    () => pipelineStages(project.pipelinePreset),
    [project.pipelinePreset],
  );
  const selectedStages = pipelineStages(selected);
  const added = selectedStages.filter((stage) => !currentStages.includes(stage));
  const removed = currentStages.filter((stage) => !selectedStages.includes(stage));
  const changed = selected !== project.pipelinePreset;
  const missingTarget = added.some((stage) => !environmentTargets[stage]);

  return (
    <div className="flex flex-col gap-4">
      <PipelinePresetField
        value={selected}
        onChange={setSelected}
        disabled={!canMaintain || busy}
      />

      {added.length > 0 && (
        <EnvironmentTargetFields
          template={template}
          targets={targets}
          values={environmentTargets}
          hosted={hosted}
          environments={added}
          onChange={(environment, targetId) =>
            setEnvironmentTargets((current) => ({ ...current, [environment]: targetId }))
          }
        />
      )}

      {removed.length > 0 && (
        <Notice tone="warning">
          {t(
            'Removing {removed} is allowed only after its deployment and pending cleanup are gone. Deployment history for the removed stage is deleted with that environment; the audit event remains.',
            { removed: removed.join(', ') },
          )}
        </Notice>
      )}

      {!canMaintain && (
        <p className="text-sm text-muted-foreground">
          {t('A maintainer, admin or owner can change the project pipeline.')}
        </p>
      )}

      {canMaintain && (
        <div>
          <Button
            size="sm"
            disabled={!changed || busy || missingTarget || !template}
            onClick={() =>
              onSave(
                selected,
                selectedStages.map((name) => ({
                  name,
                  targetId: environmentTargets[name] || undefined,
                })),
              )
            }
          >
            <Save className="h-4 w-4" /> {busy ? t('Saving…') : t('Save pipeline')}
          </Button>
        </div>
      )}
    </div>
  );
}
