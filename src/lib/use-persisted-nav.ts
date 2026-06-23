"use client";
import { useCallback, useState } from "react";

// UX-only navigation persistence. Same policy as the customer shell
// (src/app/page.tsx, `makhbartak.customer.nav.v1`): sessionStorage is a hint
// that survives a hard refresh within the same browser tab; it never holds
// business data and clearing it only resets which tab/section is shown.
//
// Each portal passes a versioned key. The optional `isValid` guard drops a
// stored value the current role/session can no longer reach (e.g. a different
// admin role signs in within the same tab), falling back to `fallback`.
export function usePersistedNav<T extends string>(
  key: string,
  fallback: T,
  isValid?: (v: T) => boolean,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const raw = window.sessionStorage.getItem(key) as T | null;
      if (raw && (!isValid || isValid(raw))) return raw;
    } catch {}
    return fallback;
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      if (typeof window !== "undefined") {
        try { window.sessionStorage.setItem(key, v); } catch {}
      }
    },
    [key],
  );
  return [value, set];
}
