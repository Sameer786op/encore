import { useEffect, useState } from "react";

/** load something for a page; reloads when `key` changes */
export function useAsync<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ key: string; data?: T; error?: unknown }>({ key });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ key });
    load().then(
      (data) => alive && setState({ key, data }),
      (error) => alive && setState({ key, error }),
    );
    return () => {
      alive = false;
    };
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = state.key === key ? state : { key };
  return { data: current.data, error: current.error, loading: !current.data && !current.error, retry: () => setAttempt((a) => a + 1) };
}
