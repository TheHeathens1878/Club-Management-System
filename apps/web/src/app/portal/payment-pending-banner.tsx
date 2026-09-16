"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Callout } from "@/components/ui/callout";

export function PaymentPendingBanner(_props: { checkoutId: string }) {
  const router = useRouter();

  // Poll every 3 seconds — the portal page is force-dynamic so each refresh
  // re-fetches booking payments. Once the payment lands, the banner disappears
  // because the URL no longer contains payment_pending.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <Callout
      tone="warning"
      title="Payment processing…"
      icon={<Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
    >
      Your payment is being confirmed by SumUp. This page will update automatically — please
      don&apos;t close it.
    </Callout>
  );
}
