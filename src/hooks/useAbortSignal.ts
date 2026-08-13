import { useEffect, useRef } from 'react';

/**
 * Returns an AbortSignal that is aborted when the component unmounts.
 * Pass this to fetch calls and timeouts to clean up on unmount.
 */
export function useAbortSignal(): AbortSignal {
  const controllerRef = useRef<AbortController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new AbortController();
  }

  useEffect(() => {
    const controller = controllerRef.current!;
    return () => {
      controller.abort();
      controllerRef.current = new AbortController();
    };
  }, []);

  return controllerRef.current.signal;
}
