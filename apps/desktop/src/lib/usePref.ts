import { useEffect, useState } from "react";

/** State that is remembered between launches (view preferences only). */
export function usePref<T>(key: string, initial: T) {
  const storageKey = `masthead.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Preferences are a convenience; ignore storage being unavailable.
    }
  }, [storageKey, value]);
  return [value, setValue] as const;
}
