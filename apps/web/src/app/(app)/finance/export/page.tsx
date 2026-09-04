import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { requireFinance } from "@/lib/finance";

/**
 * Xero exports. Plain GET forms straight at the CSV route — the browser
 * downloads the file, nothing to keep in state.
 */
export default async function FinanceExportPage() {
  await requireFinance();

  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;

  return (
    <>
      <PageHeader title="Xero export" subtitle="CSVs shaped for Xero's importers" />
      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Sales invoices</CardTitle>
            <p className="text-sm text-muted-foreground">
              One line per charge (outstanding and paid), contact = the lead member, invoice number =
              CHG-n, account codes per kind from Finance → Settings. Import in Xero under Business →
              Invoices → Import.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <form action="/api/finance/xero" method="get" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="type" value="invoices" />
              <div className="space-y-1">
                <Label htmlFor="inv-from">From</Label>
                <Input id="inv-from" type="date" name="from" defaultValue={yearStart} className="w-44" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="inv-to">To</Label>
                <Input id="inv-to" type="date" name="to" defaultValue={today} className="w-44" />
              </div>
              <button type="submit" className="min-h-[44px] rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Download invoices CSV
              </button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Bank statement</CardTitle>
            <p className="text-sm text-muted-foreground">
              One line per payment, negative lines for refunds — for reconciling against the bank or
              SumUp settlement feed. Import in Xero under Accounting → Bank accounts → Import a
              statement.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <form action="/api/finance/xero" method="get" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="type" value="bank" />
              <div className="space-y-1">
                <Label htmlFor="bank-from">From</Label>
                <Input id="bank-from" type="date" name="from" defaultValue={yearStart} className="w-44" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bank-to">To</Label>
                <Input id="bank-to" type="date" name="to" defaultValue={today} className="w-44" />
              </div>
              <button type="submit" className="min-h-[44px] rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Download bank CSV
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
