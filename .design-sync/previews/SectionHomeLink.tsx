import { SectionHomeLink } from "@club/web";
import { Landmark } from "lucide-react";

window.__dsPathname = "/finance/invoices";

export const FinanceHome = () => (
  <SectionHomeLink href="/finance" label="Finance home" icon={<Landmark className="h-4 w-4" />} />
);
