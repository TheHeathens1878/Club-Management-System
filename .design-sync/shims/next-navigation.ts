// Stand-in for next/navigation inside the Claude Design bundle. The current
// path is whatever the preview says it is (window.__dsPathname, default "/"),
// so route-aware components can show an active state without a router.
declare global {
  interface Window { __dsPathname?: string; __dsSearch?: string }
}

export function usePathname(): string {
  return (typeof window !== "undefined" && window.__dsPathname) || "/";
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams((typeof window !== "undefined" && window.__dsSearch) || "");
}

export function useRouter() {
  const noop = () => {};
  return { push: noop, replace: noop, back: noop, forward: noop, refresh: noop, prefetch: noop };
}

export function useParams(): Record<string, string> { return {}; }
export function useSelectedLayoutSegment(): string | null { return null; }
export function useSelectedLayoutSegments(): string[] { return []; }
export function redirect(): never { throw new Error("redirect() is not available in a design preview"); }
export function notFound(): never { throw new Error("notFound() is not available in a design preview"); }
