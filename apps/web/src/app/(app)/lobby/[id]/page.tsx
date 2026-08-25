import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Pin } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { formatEventDate } from "@/app/(app)/events/shared";
import { createClient } from "@/lib/supabase/server";

import { PostControls, ReplyForm } from "./reply-form";

/**
 * One post, one thread. Adam's rule made visible: however the post reached
 * someone — the lobby, or pushed onto their team's bulletin board — this page
 * is where every reply lands. Opening it is what counts as reading it.
 */

export const dynamic = "force-dynamic";

export default async function LobbyPostPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const { id } = await params;

  const supabase = await createClient();
  const [detailResult, threadResult] = await Promise.all([
    supabase.rpc("board_post_detail", { p_post_id: id }),
    supabase.rpc("board_post_thread", { p_post_id: id }),
  ]);
  const post = detailResult.data?.[0];
  if (detailResult.error || !post) notFound();

  // Opening the thread is the read receipt behind "41 of 46 read".
  await supabase.rpc("mark_board_posts_read", { p_post_ids: [id] });

  const replies = threadResult.data ?? [];

  return (
    <>
      <PageHeader
        title={post.title}
        subtitle={`${post.author_name} · ${formatEventDate(post.created_at)}`}
        action={
          <Link href="/lobby" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ArrowLeft className="h-4 w-4" /> Club lobby
          </Link>
        }
      />

      <div className="max-w-3xl space-y-4 p-6">
        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="flex flex-wrap items-center gap-2">
              {post.pinned ? (
                <Badge variant="warning">
                  <Pin className="h-3 w-3" /> Pinned
                </Badge>
              ) : null}
              {post.audience === "teams" && post.team_names ? (
                <Badge variant="outline">For {post.team_names.join(", ")}</Badge>
              ) : (
                <Badge variant="muted">Club-wide</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {post.read_of !== null
                  ? `${post.read_count} of ${post.read_of} read`
                  : `${post.read_count} read`}
              </span>
            </p>
            <p className="whitespace-pre-line text-sm leading-relaxed">{post.body}</p>
            {post.can_manage ? <PostControls postId={post.post_id} pinned={post.pinned} /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-5">
            <p className="text-sm font-semibold">
              {replies.length === 0
                ? "No replies yet"
                : `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
              <span className="ml-2 font-normal text-muted-foreground">
                — one thread, wherever the post was seen
              </span>
            </p>
            {replies.map((reply) => (
              <div key={reply.reply_id} className="rounded-md border bg-card px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {reply.is_mine ? "You" : reply.author_name} · {formatEventDate(reply.created_at)}
                </p>
                <p className="mt-1 whitespace-pre-line text-sm">{reply.body}</p>
              </div>
            ))}
            <ReplyForm postId={post.post_id} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
