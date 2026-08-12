import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type TargetAllocation,
  type TargetAllocationInput,
  type TargetInput,
} from '@/api';
import { useToast } from '@/toast';
import type { Target } from '@/types';

/** Owns Infrastructure data and mutations independently of its presentation. */
export function useInfrastructure(workspaceId?: string) {
  const toast = useToast();
  const requestSequence = useRef(0);
  const [targets, setTargets] = useState<Target[]>([]);
  const [allocations, setAllocations] = useState<TargetAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);
  const [savingAllocation, setSavingAllocation] = useState(false);
  const [busyTargetId, setBusyTargetId] = useState<string | null>(null);
  const [busyAllocationId, setBusyAllocationId] = useState<string | null>(null);

  const refresh = useCallback(async (showLoading = false) => {
    const request = ++requestSequence.current;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [rawTargets, nextAllocations] = await Promise.all([
        api.listTargets(),
        api.listAllocations(),
      ]);
      const nextTargets = await Promise.all(rawTargets.map(async (target) =>
        target.scope === 'user' && target.kind === 'docker'
          ? { ...target, agent: await api.getTargetAgent(target.id) }
          : target,
      ));
      if (request !== requestSequence.current) return;
      setTargets(nextTargets);
      setAllocations(nextAllocations);
    } catch (cause) {
      if (request === requestSequence.current) {
        setError((cause as Error).message);
      }
    } finally {
      // A background refresh may supersede an initial request (for example
      // while the active workspace changes). Whichever request wins must also
      // release the loading state.
      if (request === requestSequence.current) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setTargets([]);
    setAllocations([]);
    void refresh(true);
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (!workspaceId) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [refresh, workspaceId]);

  async function saveTarget(target: Target | null, values: TargetInput) {
    setSavingTarget(true);
    try {
      const saved = target
        ? await api.updateTarget(target.id, values)
        : await api.createTarget(values);
      toast.success(target ? 'Target saved' : 'Target added');
      await refresh();
      return saved;
    } catch (cause) {
      toast.error((cause as Error).message);
      return null;
    } finally {
      setSavingTarget(false);
    }
  }

  async function issueAgentEnrollment(target: Target) {
    setBusyTargetId(target.id);
    try {
      const enrollment = await api.issueAgentEnrollment(target.id);
      toast.success('One-time Agent enrollment created');
      await refresh();
      return enrollment;
    } catch (cause) {
      toast.error((cause as Error).message);
      return null;
    } finally {
      setBusyTargetId(null);
    }
  }

  async function disableAgent(target: Target) {
    setBusyTargetId(target.id);
    try {
      await api.disableAgent(target.id);
      toast.success('Agent disabled');
      await refresh();
      return true;
    } catch (cause) {
      toast.error((cause as Error).message);
      return false;
    } finally {
      setBusyTargetId(null);
    }
  }

  async function verifyTarget(target: Target) {
    setBusyTargetId(target.id);
    try {
      const result = await api.verifyTarget(target.id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      await refresh();
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusyTargetId(null);
    }
  }

  async function deleteTarget(target: Target) {
    setBusyTargetId(target.id);
    try {
      await api.deleteTarget(target.id);
      toast.success(`Removed ${target.name}`);
      await refresh();
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusyTargetId(null);
    }
  }

  async function saveAllocation(
    allocation: TargetAllocation | null,
    values: TargetAllocationInput,
  ) {
    setSavingAllocation(true);
    try {
      if (allocation) {
        await api.updateAllocation(allocation.id, {
          capabilities: values.capabilities,
          ...(values.publicUrl ? { publicUrl: values.publicUrl } : {}),
          maxEnvironments: values.maxEnvironments,
        });
        toast.success('Allocation saved');
      } else {
        await api.createAllocation(values);
        toast.success('Target allocated to this workspace');
      }
      await refresh();
      return true;
    } catch (cause) {
      toast.error((cause as Error).message);
      return false;
    } finally {
      setSavingAllocation(false);
    }
  }

  async function toggleAllocation(allocation: TargetAllocation) {
    setBusyAllocationId(allocation.id);
    try {
      await api.updateAllocation(allocation.id, {
        status: allocation.status === 'active' ? 'disabled' : 'active',
      });
      toast.success(allocation.status === 'active' ? 'Allocation disabled' : 'Allocation enabled');
      await refresh();
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusyAllocationId(null);
    }
  }

  async function deleteAllocation(allocation: TargetAllocation) {
    setBusyAllocationId(allocation.id);
    try {
      await api.deleteAllocation(allocation.id);
      toast.success(`Removed allocation of ${allocation.targetName}`);
      await refresh();
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusyAllocationId(null);
    }
  }

  return {
    targets,
    allocations,
    loading,
    error,
    savingTarget,
    savingAllocation,
    busyTargetId,
    busyAllocationId,
    reload: () => refresh(true),
    saveTarget,
    verifyTarget,
    deleteTarget,
    issueAgentEnrollment,
    disableAgent,
    saveAllocation,
    toggleAllocation,
    deleteAllocation,
  };
}
