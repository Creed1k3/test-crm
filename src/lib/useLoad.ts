import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../components/ui";

export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    load()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
    // The caller supplies every value read by load as a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  return { data, error, refresh };
}
