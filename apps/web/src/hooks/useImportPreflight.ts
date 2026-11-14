import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import type { ImportPreflight } from '@/types';

export const PREFLIGHT_DEBOUNCE_MS = 400;

/**
 * Checks the selected repository against the selected template automatically.
 * Every run takes a sequence number and only the latest run may publish its
 * result, so a slow answer for an earlier choice can never unlock the import
 * of the current one.
 */
export function useImportPreflight(repositoryId: string, templateId: string) {
  const [preflight, setPreflight] = useState<ImportPreflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async (repository: string, template: string) => {
    const request = ++sequence.current;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPreflight(null);
    setError(null);
    if (!repository || !template) {
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      const result = await api.importPreflight(repository, template, { signal: current.signal });
      if (request === sequence.current) setPreflight(result);
    } catch (cause) {
      if (request === sequence.current && !current.signal.aborted) {
        setError((cause as Error).message);
      }
    } finally {
      if (request === sequence.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    // A fresh choice invalidates the previous result immediately.
    sequence.current++;
    controller.current?.abort();
    setPreflight(null);
    setError(null);
    if (!repositoryId || !templateId) {
      setChecking(false);
      return;
    }
    setChecking(true);
    const timer = window.setTimeout(
      () => void run(repositoryId, templateId),
      PREFLIGHT_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [repositoryId, templateId, run]);

  useEffect(() => () => controller.current?.abort(), []);

  const rerun = useCallback(() => run(repositoryId, templateId), [run, repositoryId, templateId]);

  return { preflight, checking, error, rerun };
}
