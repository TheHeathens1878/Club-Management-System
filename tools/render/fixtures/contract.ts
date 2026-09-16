import type { ReactElement } from "react";

/**
 * What a fixture file default-exports.
 *
 * A fixture names the states of one component that are worth photographing.
 * Each case is a component of no props, so the harness can mount it on its own
 * — one case per screenshot, never several stacked in a column, because a
 * column hides which one owns an overflow.
 *
 * A fixture may also set `window.__dsPathname` / `window.__dsSearch` at module
 * scope: the next/navigation shim reads them, so a component that lights up an
 * active link can be photographed on the route it belongs to.
 */
export type Fixture = {
  cases: Record<string, () => ReactElement>;
};
