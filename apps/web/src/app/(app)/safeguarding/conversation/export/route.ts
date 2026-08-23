import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * SG-9 export (P5.6). `export_conversation_as_lead()` returns the complete
 * history — including soft-deleted and redacted rows — as jsonb, and writes
 * the `messaging.conversation.export` audit row with the message count before
 * it returns. This handler is a download wrapper around that call and nothing
 * more: the user-scoped client means the accessor sees the real caller, and
 * the accessor's own role check is the gate.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const reason = request.nextUrl.searchParams.get("reason");
  if (!id || !reason) {
    return NextResponse.json({ error: "A conversation id and a reason are both required." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data, error } = await supabase.rpc("export_conversation_as_lead", {
    p_conversation_id: id,
    p_reason: reason,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="conversation-${id}.json"`,
      "cache-control": "no-store",
    },
  });
}
