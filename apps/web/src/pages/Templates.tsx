import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ArrowRight } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/molecules/PageHeader';
import { TemplateIcon } from '@/components/atoms/TemplateIcon';
import type { TemplateManifest } from '@/types';

export default function Templates() {
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listTemplates().then(setTemplates).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        title="Templates"
        subtitle="Catalog of project templates. Each one ships with code, a Dockerfile and a CI/CD pipeline, so a new project is ready to build and deploy."
        actions={
          <Button asChild>
            <Link to="/new">
              <Plus className="h-4 w-4" /> New project
            </Link>
          </Button>
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {loading && <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Loading templates">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-44 animate-pulse rounded-lg border border-border bg-card/60" />)}
      </div>}

      {!loading && <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
      </div>}
    </div>
  );
}
