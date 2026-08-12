import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { useToast } from '@/toast';
import type { AgentJobSummary, AgentStatus, Target } from '@/types';

/** Live, dialog-scoped view of one physical Agent and its recent durable jobs. */
export function useAgentProtocol(target: Target | null) {
  const toast = useToast();
  const requestSequence = useRef(0);
  const [agent, setAgent] = useState<AgentStatus | null>(target?.agent ?? null);
  const [jobs, setJobs] = useState<AgentJobSummary[]>([]);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetId = target?.id;

  const refresh = useCallback(async () => {
    if (!targetId) return;
    const request = ++requestSequence.current;
    try {
      const [nextAgent, nextJobs] = await Promise.all([
        api.getTargetAgent(targetId),
        api.listAgentJobs(targetId),
      ]);
      if (request !== requestSequence.current) return;
      setAgent(nextAgent);
      setJobs(nextJobs);
      setError(null);
    } catch (cause) {
      if (request === requestSequence.current) setError((cause as Error).message);
    }
  }, [targetId]);

  useEffect(() => {
    setAgent(target?.agent ?? null);
  }, [target]);

  useEffect(() => {
    if (!targetId) {
      setJobs([]);
      setError(null);
      return;
    }
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 2_500);
    return () => {
      window.clearInterval(interval);
      requestSequence.current += 1;
    };
  }, [refresh, targetId]);

  async function testProtocol(): Promise<void> {
    if (!targetId || testing) return;
    setTesting(true);
    try {
      const created = await api.createAgentProbeJob(targetId, crypto.randomUUID());
      setJobs((current) => [created, ...current.filter((job) => job.id !== created.id)].slice(0, 10));
      toast.success('Durable Agent protocol probe queued');
      await refresh();
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setTesting(false);
    }
  }

  return { agent, jobs, error, testing, testProtocol };
}
