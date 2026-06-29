import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import { Icon } from '@/components/Icon';
import type { TemplateManifest } from '@/types';

export default function NewProject() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [name, setName] = useState('muj-projekt');
  const [templateId, setTemplateId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listTemplates().then((t) => {
      setTemplates(t);
      if (t[0]) setTemplateId(t[0].id);
    });
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject(name, templateId);
      navigate(`/projects/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Nový projekt</h1>
      </div>
      <p className="lead" style={{ marginTop: '-18px', marginBottom: '28px' }}>
        Vyber šablonu a platforma připraví repozitář, kód, CI/CD i běžící aplikaci.
      </p>

      <div className="field">
        <label className="label">Název projektu</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="field">
        <label className="label">Šablona</label>
        <div className="templates">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`template ${t.id === templateId ? 'selected' : ''}`}
              onClick={() => setTemplateId(t.id)}
            >
              <div className="template-icon">
                <Icon name="box" size={22} />
              </div>
              <div className="template-name">{t.name}</div>
              <div className="template-lang">{t.language}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="note" style={{ marginBottom: 24 }}>
        <Icon name="rocket" size={18} />
        <span>
          Projekt projde prostředími <b>dev → test → prod</b>. Po vytvoření se nasadí
          do <b>dev</b>; do test a prod se povyšuje ručně z detailu.
        </span>
      </div>

      {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}

      <button className="btn btn-primary" disabled={busy || !templateId} onClick={submit}>
        <Icon name="rocket" size={16} />
        {busy ? 'Vytvářím…' : 'Vytvořit projekt'}
      </button>
    </div>
  );
}
