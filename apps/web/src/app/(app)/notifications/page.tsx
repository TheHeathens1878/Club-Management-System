import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile } from "@/lib/auth";
import { NOTIFICATIONS_PAGE_SIZE } from "@/lib/notifications";
import { loadNotifications } from "@/lib/notifications-data";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { MarkAllReadButton, NotificationsList } from "./notifications-list";

/**
 * `/notifications` — the in-app feed (gap 5).
 *
 * Open to every signed-in member: the rows are the caller's own, and
 * `loadNotifications` pins them to `current_person_id()` so a club
 * administrator — who may read the whole club's `outbound_messages` for the
 * comms audit — still sees only their own inbox here.
 *
 * Nothing on this page sends anything. The feed is the delivery.
 */

export const dynamic = "force-dynamic";

function pageNumber(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { page: pageParam } = await searchParams;
  const feed = await loadNotifications(pageNumber(pageParam));

  const firstOnPage = (feed.page - 1) * NOTIFICATIONS_PAGE_SIZE + 1;
  const lastOnPage = Math.min(feed.page * NOTIFICATIONS_PAGE_SIZE, feed.total);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={
          feed.unread > 0
            ? `${feed.unread} unread`
            : "What the club has told you, newest first"
        }
        action={feed.personId ? <MarkAllReadButton unread={feed.unread} /> : undefined}
      />
      <div className="max-w-3xl space-y-6 p-6">
        {feed.personId === null ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Your sign-in is not linked to a member record yet, so there is nothing addressed to
              you. A club administrator can link it on your member profile.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Your notifications</CardTitle>
              <p className="text-sm text-muted-foreground">
                {feed.total === 0
                  ? "Nothing has been sent to you yet."
                  : `Showing ${firstOnPage}–${lastOnPage} of ${feed.total}. Opening one marks it read.`}
              </p>
            </CardHeader>
            <CardContent className="px-3">
              {feed.error ? (
                <p className="px-3 text-sm text-destructive">
                  Could not load your notifications: {feed.error}
                </p>
              ) : (
                <NotificationsList items={feed.items} />
              )}
            </CardContent>
          </Card>
        )}

        {feed.pageCount > 1 && (
          <div className="flex items-center justify-between gap-3">
            {feed.page > 1 ? (
              <Link
                href={`/notifications?page=${feed.page - 1}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <ChevronLeft className="h-4 w-4" /> Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs text-muted-foreground">
              Page {feed.page} of {feed.pageCount}
            </span>
            {feed.page < feed.pageCount ? (
              <Link
                href={`/notifications?page=${feed.page + 1}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Older <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </div>
    </>
  );
}
