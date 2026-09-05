"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

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
    <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
      <div>
        <p className="font-medium">Payment processing…</p>
        <p className="text-xs mt-0.5">
          Your payment is being confirmed by SumUp. This page will update automatically — please don&apos;t close it.
        </p>
      </div>
    </div>
  );
}
