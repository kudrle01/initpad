import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ArrowRight, LayoutTemplate } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  const {
    data: templates,
    loading,
    error,
    reload,
  } = useLoadable<TemplateManifest[]>(loadTemplates, []);

  return (
    <div>
      <PageHeader
        title="Project templates"
        description="Maintained starting points — pick one and InitPad creates the repository, pipeline and environments."
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} className="flex flex-col p-5">
              <div className="flex min-w-0 items-center gap-3">
                <TemplateIcon templateId={t.id} language={t.language} />
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold tracking-tight" title={t.name}>
                    {t.name}
                  </h2>
                  <div className="truncate text-sm text-muted-foreground">{t.language}</div>
                </div>
              </div>
              <p
                className="mt-4 line-clamp-3 flex-1 text-sm text-muted-foreground"
                title={t.description}
              >
                {t.description}
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                <Badge variant="brand">{t.artifact}</Badge>
                {t.compatibleProviders.map((p) => (
                  <Badge key={p}>{p}</Badge>
                ))}
              </div>
              <Button asChild variant="soft" className="mt-5 w-full">
                <Link to={`/new?template=${encodeURIComponent(t.id)}`}>
                  Use template <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
