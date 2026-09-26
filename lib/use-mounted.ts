import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true afterwards. Avoids hydration mismatches. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
