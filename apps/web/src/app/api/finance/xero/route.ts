import { NextRequest, NextResponse } from "next/server";

import { getCapabilities } from "@/lib/capabilities";
import { getSessionProfile } from "@/lib/auth";
import { chargeRef, csvLine, formatMemberNo } from "@/lib/finance";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Xero exports (Adam, 2026-09-04: "exportable to Xero").
 *
 *   ?type=invoices — Xero's sales-invoice CSV: one line per charge, contact =
 *     the lead member with their membership number, InvoiceNumber = CHG-n,
 *     account code by charge kind from finance.* settings.
 *   ?type=bank     — Xero's bank-statement CSV: one line per payment (and a
 *     negative line per refund), for reconciling the club's bank/SumUp feed.
 *
 * Guarded like every finance screen; the data is read through the caller's
 * own client, so the RLS finance gate is the real door.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionProfile();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const capabilities = await getCapabilities();
  if (!capabilities.hasFinanceRole) return NextResponse.json({ error: "Finance access required" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const type = params.get("type") ?? "invoices";
  const from = params.get("from") || "1970-01-01";
  const to = params.get("to") || "2999-12-31";

  const supabase = await createClient();
  const { data: settingRows } = await supabase
    .from("site_settings")
    .select("key,value")
    .like("key", "finance.%");
  const settings = new Map((settingRows ?? []).map((row) => [row.key, row.value]));
  const accountCode = (kind: string) =>
    settings.get(`finance.xero_account_${kind}`) ?? settings.get("finance.xero_account_other") ?? "200";
  const taxType = settings.get("finance.xero_tax_type") ?? "No VAT";

  if (type === "invoices") {
    const { data: charges } = await supabase
      .from("charges")
      .select(
        "charge_no,kind,description,amount_pence,due_on,created_at,status,billing_accounts(member_no,people(first_name,last_name,email))",
      )
      .in("status", ["pending", "paid"])
      .gte("created_at", from)
      .lte("created_at", `${to}T23:59:59`)
      .order("charge_no");

    const lines = [
      csvLine([
        "*ContactName", "EmailAddress", "*InvoiceNumber", "Reference", "*InvoiceDate", "*DueDate",
        "*Description", "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType",
      ]),
    ];
    for (const charge of charges ?? []) {
      const lead = charge.billing_accounts?.people;
      const contact = lead ? `${lead.first_name} ${lead.last_name}` : "Unknown member";
      const memberNo = charge.billing_accounts ? formatMemberNo(charge.billing_accounts.member_no) : "";
      lines.push(
        csvLine([
          contact,
          lead?.email ?? "",
          chargeRef(charge.charge_no),
          memberNo,
          new Date(charge.created_at).toISOString().slice(0, 10),
          charge.due_on,
          charge.description,
          1,
          (charge.amount_pence / 100).toFixed(2),
          accountCode(charge.kind),
          taxType,
        ]),
      );
    }
    return csvResponse(lines, `xero-invoices-${from}-to-${to}.csv`);
  }

  if (type === "bank") {
    const { data: payments } = await supabase
      .from("payments")
      .select(
        "amount_pence,refunded_pence,refunded_at,paid_at,method,source,reference,sumup_txn_code,kind,charges(charge_no,description,billing_accounts(member_no,people(first_name,last_name))),bookings(booker_name)",
      )
      .gte("paid_at", from)
      .lte("paid_at", `${to}T23:59:59`)
      .order("paid_at");

    const lines = [csvLine(["*Date", "*Amount", "Payee", "Description", "Reference"])];
    for (const payment of payments ?? []) {
      const lead = payment.charges?.billing_accounts?.people;
      const payee = lead
        ? `${lead.first_name} ${lead.last_name}`
        : (payment.bookings?.booker_name ?? "Unknown");
      const description = payment.charges
        ? payment.charges.description
        : payment.kind === "hire"
          ? "Function room hire"
          : "Payment";
      const reference =
        (payment.charges ? chargeRef(payment.charges.charge_no) : null) ??
        payment.reference ??
        payment.sumup_txn_code ??
        "";
      const date = payment.paid_at ? new Date(payment.paid_at).toISOString().slice(0, 10) : "";
      lines.push(csvLine([date, (payment.amount_pence / 100).toFixed(2), payee, description, reference]));
      if (payment.refunded_pence > 0) {
        const refundDate = payment.refunded_at ? new Date(payment.refunded_at).toISOString().slice(0, 10) : date;
        lines.push(
          csvLine([refundDate, (-payment.refunded_pence / 100).toFixed(2), payee, `Refund — ${description}`, reference]),
        );
      }
    }
    return csvResponse(lines, `xero-bank-${from}-to-${to}.csv`);
  }

  return NextResponse.json({ error: "Unknown export type" }, { status: 400 });
}

function csvResponse(lines: string[], filename: string): NextResponse {
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
