import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads one page resource, ignores stale responses and exposes a user-triggered
 * retry. The loader should be memoized; changing it reloads and clears old data.
 */
export function useLoadable<T>(loader: () => Promise<T>, initialValue: T) {
  const initialValueRef = useRef(initialValue);
  const requestSequence = useRef(0);
  const [data, setData] = useState(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const nextData = await loader();
      if (request === requestSequence.current) setData(nextData);
    } catch (cause) {
      if (request === requestSequence.current) setError((cause as Error).message);
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, [loader]);

  useEffect(() => {
    setData(initialValueRef.current);
    void reload();
    return () => {
      requestSequence.current += 1;
    };
  }, [reload]);

  return { data, loading, error, reload };
}
