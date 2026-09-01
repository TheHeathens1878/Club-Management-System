"use client";

import { useRouter } from "next/navigation";

/**
 * A table row that is a link everywhere — the matchday-desk rule (Adam,
 * 2026-08-24: "clicking anywhere on the row should take them into the match /
 * event") — except clicks landing on a real anchor inside it, which keep
 * their own destination (a Register link, a maps pin). Same guard as the team
 * fixtures list.
 */
export function LinkRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <tr
      className={`cursor-pointer ${className ?? ""}`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
