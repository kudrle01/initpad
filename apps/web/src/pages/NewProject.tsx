import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type EnvConfig } from '@/api';
import { useToast } from '@/toast';
import { Icon } from '@/components/Icon';
import type { EnvName, ProviderKind, TemplateManifest } from '@/types';

const ENV_ORDER: EnvName[] = ['dev', 'test', 'prod'];

function defaultProvider(env: EnvName, template: TemplateManifest): ProviderKind {
  const wanted: ProviderKind = env === 'prod' ? (template.artifact === 'static' ? 'sftp' : 'ssh') : 'docker';
  return template.compatibleProviders.includes(wanted) ? wanted : template.compatibleProviders[0];
}

export default function NewProject() {
  const navigate = useNavigate();
  const toast = useToast();
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [name, setName] = useState('my-project');
  const [templateId, setTemplateId] = useState<string>('');
  const [envs, setEnvs] = useState<EnvConfig[]>([]);
  const [busy, setBusy] = useState(false);

  const template = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  );

  useEffect(() => {
    api.listTemplates().then((t) => {
      setTemplates(t);
      if (t[0]) setTemplateId(t[0].id);
    });
  }, []);

  // Reset environment providers to defaults whenever the template changes.
  useEffect(() => {
    if (!template) return;
    setEnvs(ENV_ORDER.map((envName) => ({ name: envName, provider: defaultProvider(envName, template) })));
  }, [template]);

  function setProvider(envName: EnvName, provider: ProviderKind) {
    setEnvs((cur) => cur.map((e) => (e.name === envName ? { ...e, provider } : e)));
  }

  async function submit() {
    setBusy(true);
    try {
      const project = await api.createProject(name, templateId, envs);
      toast.success('Project created');
      navigate(`/projects/${project.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>New project</h1>
      </div>
      <p className="lead" style={{ marginTop: '-18px', marginBottom: '28px' }}>
        Pick a template and the platform sets up the repository, code, CI/CD and a running app.
      </p>

      <div className="field">
        <label className="label">Project name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="field">
        <label className="label">Template</label>
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

      <div className="field">
        <label className="label">Environments</label>
        <div className="env-config">
          {envs.map((e, i) => (
            <div key={e.name} className="env-config-row">
              <span className={`env-tag env-tag-${e.name}`}>{e.name}</span>
              <select
                className="input env-select"
                value={e.provider}
                onChange={(ev) => setProvider(e.name, ev.target.value as ProviderKind)}
              >
                {template?.compatibleProviders.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              {i < envs.length - 1 && (
                <span className="env-config-arrow">
                  <Icon name="arrowRight" size={14} />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="note" style={{ marginBottom: 24 }}>
        <Icon name="rocket" size={18} />
        <span>
          The project moves through <b>dev → test → prod</b>. After creation it is deployed
          to <b>dev</b>; promote to test and prod manually from the detail page.
        </span>
      </div>

      <button className="btn btn-primary" disabled={busy || !templateId} onClick={submit}>
        <Icon name="rocket" size={16} />
        {busy ? 'Creating…' : 'Create project'}
      </button>

      {busy && (
        <div className="create-overlay">
          <div className="create-card">
            <div className="spinner" />
            <div className="create-title">Setting up “{name}”</div>
            <ul className="create-steps">
              <li>Creating Git repository</li>
              <li>Generating project scaffold</li>
              <li>Booting the dev environment</li>
            </ul>
            <p className="create-note">Redirecting to your project…</p>
          </div>
        </div>
      )}
    </div>
  );
}
