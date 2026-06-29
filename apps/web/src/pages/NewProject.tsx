import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
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
      <p className="muted">
        Vyplň formulář a platforma připraví repo, kód, pipeline i běžící aplikaci.
      </p>

      <label className="field-label">Název projektu</label>
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <label className="field-label">Šablona</label>
      <div className="template-grid">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`template-card ${t.id === templateId ? 'selected' : ''}`}
            onClick={() => setTemplateId(t.id)}
          >
            <div className="template-name">{t.name}</div>
            <div className="template-sub">{t.language}</div>
          </button>
        ))}
      </div>

      <div className="info-box">
        Projekt projde prostředími <b>dev → test → prod</b>. Po vytvoření se nasadí
        do <b>dev</b>; do test a prod se povyšuje ručně z detailu projektu.
      </div>

      {error && <p className="error">{error}</p>}

      <button className="btn btn-primary" disabled={busy || !templateId} onClick={submit}>
        {busy ? 'Vytvářím…' : 'Vytvořit projekt'}
      </button>
    </div>
  );
}
