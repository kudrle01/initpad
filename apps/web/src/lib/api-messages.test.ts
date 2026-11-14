import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadLocaleMessages, setLocale } from '@/i18n';
import { API_MESSAGE_RULES, translateApiMessage } from './api-messages';

// Messages exactly as the API sends them, taken from apps/api/src.
const REAL_MESSAGES = [
  'Workspace not found',
  "Project 'cm3x9' not found",
  "Target 'lab-01' not found",
  "Environment 'prod' not found",
  'Workspace admin access required to manage the Agent',
  'Workspace write access required',
  'Invalid username or password',
  'Too many attempts. Try again later.',
  'This link is invalid or has expired',
  "This workspace already has a project named 'billing-api'",
  "A repository named 'acme/billing-api' already exists in github. Choose a different project name, or import the existing repository.",
  'Cannot import an empty repository — push code first.',
  "Cannot import 'acme/site': no Dockerfile exists on 'main' for the selected runtime.",
  "Environment 'dev' is busy. Cancel or wait for its current operation first.",
  "Environment 'test' is busy. Wait for or cancel its operation before changing config.",
  'Production deployments must be requested and approved',
  'This workspace requires a different person to approve production',
  "You already have a target named 'lab'",
  "This workspace already has a target named 'lab'",
  'This target is used by 2 environment(s). Point them at another target first.',
  "Target 'eso' must pass Test connection before it can host an environment.",
  'Workspace access quota reached (max 5 environments).',
  'Invalid or expired Agent enrollment token',
  "'PORT' is a reserved platform variable",
  'Value must be a string up to 8192 characters',
  'CI did not produce a deployable image (CI result: failure). Open the SCM run logs, fix the failed job and run again.',
  // status reasons and operation steps
  'Waiting for an available CI runner',
  'Waiting for CI build; deployment target: Built-in Docker',
  'Waiting for Agent',
  'Uploading 3/12 files',
  'Verifying deployment',
  'Creating isolated candidate workload',
  'Cancellation requested — cleaning up',
];

// Templates the catalog depends on; when the API rewords one, this fails and
// the catalog must follow.
const API_SOURCES = [
  "'Workspace not found'",
  "`Project '${projectId}' not found`",
  "'Invalid username or password'",
  "`This workspace already has a project named '${dto.name}'`",
  "`Environment '${envName}' is busy. Cancel or wait for its current operation first.`",
  "'Production deployments must be requested and approved'",
  "`Workspace access quota reached (max ${allocation.maxEnvironments} environments).`",
  "'Invalid or expired Agent enrollment token'",
  "`'${normalizedKey}' is a reserved platform variable`",
  "'Waiting for Agent'",
  "'Verifying deployment'",
  "`Uploading ${done}/${total} files`",
];

function apiSourceText(): string {
  const root = join(__dirname, '../../../api/src');
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts') && !path.endsWith('.spec.ts'))
        parts.push(readFileSync(path, 'utf8'));
    }
  };
  walk(root);
  return parts.join('\n');
}

beforeAll(() => loadLocaleMessages('cs'));
afterEach(() => setLocale('en'));

describe('API message catalog (ADR-185)', () => {
  it('keeps every real message unchanged in English', () => {
    const changed = REAL_MESSAGES.filter(
      (message) =>
        translateApiMessage(message) !== message && !message.includes('target named'),
    );
    expect(changed).toEqual([]);
  });

  it('translates every selected real API message into Czech', async () => {
    await setLocale('cs');
    const untranslated = REAL_MESSAGES.filter((message) => {
      const translated = translateApiMessage(message);
      return translated === message || /\{\w+\}/.test(translated);
    });
    expect(untranslated).toEqual([]);
  });

  it('fills placeholders and translates nested messages', async () => {
    await setLocale('cs');
    expect(translateApiMessage("Project 'billing' not found")).toBe('Projekt billing nebyl nalezen');
    expect(translateApiMessage('Cleanup failed: Target is no longer connected')).toBe(
      'Úklid selhal: Server už není připojený',
    );
  });

  it('falls back to the original text for unknown messages', async () => {
    await setLocale('cs');
    expect(translateApiMessage('Something brand new happened')).toBe(
      'Something brand new happened',
    );
    expect(translateApiMessage(null)).toBeNull();
  });

  it('anchors every rule to the whole message', () => {
    for (const { pattern, key } of API_MESSAGE_RULES) {
      expect(pattern.source.startsWith('^') && pattern.source.endsWith('$'), key).toBe(true);
    }
  });

  it('still matches the wording used by the API source', () => {
    const source = apiSourceText();
    const missing = API_SOURCES.filter((template) => !source.includes(template));
    expect(missing).toEqual([]);
  });
});
