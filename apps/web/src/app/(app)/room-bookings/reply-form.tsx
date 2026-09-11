"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { replyToBooker } from "./actions";

/**
 * A plain email from the desk to the booker (Adam, 2026-09-11: "the ability
 * to email enquiry bookers back, with audit trail"). Subject prefilled, body
 * typed, sent as the club, logged against the booking and audited.
 */
export function ReplyForm({
  bookingId,
  bookerEmail,
  defaultSubject,
}: {
  bookingId: string;
  bookerEmail: string;
  defaultSubject: string;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSent(false);
    const result = await replyToBooker(bookingId, { subject, message });
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSent(true);
    setMessage("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-muted-foreground">
        To <span className="font-medium text-foreground">{bookerEmail}</span>, from the club&apos;s address.
        Goes in the booking&apos;s email log and the audit trail.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="reply-subject">Subject</Label>
        <Input
          id="reply-subject"
          value={subject}
          onChange={(e) => { setSubject(e.target.value); setSent(false); }}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reply-message">Message</Label>
        <textarea
          id="reply-message"
          value={message}
          onChange={(e) => { setMessage(e.target.value); setSent(false); }}
          rows={6}
          required
          placeholder="Dear …"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {sent && <p className="text-sm text-emerald-600">Sent — it is in the email log below.</p>}
      <Button type="submit" disabled={loading || !message.trim() || !subject.trim()} className="min-h-[44px] w-full lg:min-h-0 lg:w-auto">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Send email
      </Button>
    </form>
  );
}
