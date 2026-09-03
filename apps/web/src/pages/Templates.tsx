import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ArrowRight, LayoutTemplate } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { EmptyState } from '@/components/molecules/EmptyState';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { TemplateIcon } from '@/components/atoms/TemplateIcon';
import { useLoadable } from '@/hooks/useLoadable';
import type { TemplateManifest } from '@/types';

export default function Templates() {
  const loadTemplates = useCallback(() => api.listTemplates(), []);
  const { data: templates, loading, error, reload } = useLoadable<TemplateManifest[]>(
    loadTemplates,
    [],
  );

  return (
    <div>
      <PageHeader
        title="Templates"
        help={[
          {
            title: 'Template',
            description: 'A maintained starting point for a language and runtime.',
          },
          {
            title: 'Included',
            description: 'Starter code, a Dockerfile and a CI/CD workflow.',
          },
        ]}
        actions={
          <Button asChild>
            <Link to="/new">
              <Plus className="h-4 w-4" /> New project
            </Link>
          </Button>
        }
      />

      {error ? (
        <LoadErrorState message={error} onRetry={reload} />
      ) : loading ? (
        <ContentLoading label="Loading templates" variant="cards" />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title="No templates available"
          description="The platform administrator has not installed any project templates yet."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {templates.map((t) => (
          <Card key={t.id} className="flex flex-col p-5">
            <div className="flex items-center gap-3">
              <TemplateIcon templateId={t.id} language={t.language} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.language}</div>
              </div>
            </div>
            <p className="mt-3 flex-1 text-sm text-muted-foreground">{t.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {t.artifact}
              </span>
              {t.compatibleProviders.map((p) => (
                <span
                  key={p}
                  className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  {p}
                </span>
              ))}
            </div>
            <Link
              to={`/new?template=${encodeURIComponent(t.id)}`}
              className="text-link mt-4 inline-flex items-center gap-1 self-start text-sm font-medium"
            >
              Use template <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Card>
        ))}
        </div>
      )}
    </div>
  );
}
