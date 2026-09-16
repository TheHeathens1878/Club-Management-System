"use client";

/**
 * The FA Clubs Portal exports for the ticked teams (Adam, 2026-09-06: "we
 * should be able to select multiple teams and export this information").
 * Two plain download links — the spreadsheet and the photos — carrying the
 * ticked ids as `?team=`; the routes re-check club_admin and write the audit
 * row, so this bar decides nothing.
 */

import { Camera, FileSpreadsheet } from "lucide-react";

import { ActionBar } from "@/components/ui/action-bar";
import { buttonVariants } from "@/components/ui/button";

export function clubsPortalHref(kind: "export.csv" | "photos.zip", teamIds: readonly string[]): string {
  const query = teamIds.map((id) => `team=${encodeURIComponent(id)}`).join("&");
  return `/teams/clubs-portal/${kind}?${query}`;
}

export function ClubsPortalExportBar({ teamIds }: { teamIds: readonly string[] }) {
  const n = teamIds.length;
  return (
    <ActionBar
      icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
      status="FA Clubs Portal"
      detail={`${n} ${n === 1 ? "team" : "teams"} ticked — players, age proof and emergency contacts`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={clubsPortalHref("export.csv", teamIds)}
            className={`${buttonVariants({ variant: "outline", size: "touch" })}`}
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden /> Export data (CSV)
          </a>
          <a
            href={clubsPortalHref("photos.zip", teamIds)}
            className={`${buttonVariants({ variant: "outline", size: "touch" })}`}
          >
            <Camera className="h-4 w-4" aria-hidden /> Export photos (zip)
          </a>
        </div>
      }
    />
  );
}
