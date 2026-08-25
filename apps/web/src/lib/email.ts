import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";

import { enqueue, markFailed, markSent, type CommsCategory } from "@/lib/comms";

const TENANT_ID     = process.env.AZURE_TENANT_ID ?? "";
const CLIENT_ID     = process.env.AZURE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET ?? "";
const MAIL_FROM     = process.env.MAIL_FROM ?? "";

const configured = !!(TENANT_ID && CLIENT_ID && CLIENT_SECRET && MAIL_FROM);

if (!configured) {
  console.warn("Microsoft Graph email not configured — emails will not be sent.");
}

/**
 * Whether Graph can actually send. `sendEmail` skips quietly when it cannot,
 * which is right for a booking confirmation and wrong for the Supabase Send
 * Email hook: an auth email that is silently dropped locks somebody out, so
 * that route checks this first and answers Auth with a 500.
 */
export function isEmailConfigured(): boolean {
  return configured;
}

function getGraphClient(): Client {
  const credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"],
  });
  return Client.initWithMiddleware({ authProvider });
}

type SendParams = {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /**
   * P4.4. Everything this app sends today is transactional — a booking
   * confirmation, a quote, an invite, a password link — so that is the
   * default. The payment-reminder cron passes 'reminder', which is the
   * category a member may switch off.
   */
  category?: CommsCategory;
  /**
   * What to record in `outbound_messages` in place of the body. A sign-in,
   * confirmation or reset link IS a live credential; the club's record needs
   * to show that the email was sent, not to hold the key in a table an admin
   * can read. Defaults to the body itself, which is right for everything else.
   */
  logBody?: string;
  /** Optional provenance for the `outbound_messages` row. */
  template?: string;
  entity?: string;
  entityId?: string;
  personId?: string;
};

function addressList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return Array.from(new Set(list.map((a) => a.trim()).filter(Boolean)));
}

/**
 * Send an email — through P4.4's comms API.
 *
 * Every send is enqueued first (one `outbound_messages` row per recipient), so
 * the suppression list, the recipient's channel preference and the
 * platform-wide dry-run switch all apply before Graph is ever called, and the
 * result is recorded either way. Recipients the API declines are dropped from
 * the send; if that leaves nobody in `to`, nothing is sent at all.
 */
export async function sendEmail(params: SendParams) {
  if (!configured) {
    console.warn(`[email skip] Graph not configured — would have sent "${params.subject}" to ${params.to}`);
    return null;
  }

  const category: CommsCategory = params.category ?? "transactional";
  const logBody = params.logBody ?? params.text ?? params.html;

  const enqueueFor = async (address: string) => ({
    address,
    result: await enqueue({
      channel: "email",
      category,
      toAddress: address,
      personId: params.personId,
      subject: params.subject,
      body: logBody,
      template: params.template,
      entity: params.entity,
      entityId: params.entityId,
    }),
  });

  const toResults = await Promise.all(addressList(params.to).map(enqueueFor));
  const ccResults = await Promise.all(addressList(params.cc).map(enqueueFor));

  const toSend = toResults.filter((r) => r.result.send);
  const ccSend = ccResults.filter((r) => r.result.send);
  const enqueuedIds = [...toSend, ...ccSend].map((r) => r.result.messageId);

  if (toSend.length === 0) {
    const decisions = toResults.map((r) => `${r.address}: ${r.result.decision}`).join(", ");
    console.log(`[email not sent] "${params.subject}" — ${decisions || "no recipients"}`);
    return null;
  }

  const message: Record<string, unknown> = {
    subject: params.subject,
    body: { contentType: "HTML", content: params.html },
    toRecipients: toSend.map((r) => ({ emailAddress: { address: r.address } })),
  };

  if (ccSend.length > 0) {
    message.ccRecipients = ccSend.map((r) => ({ emailAddress: { address: r.address } }));
  }

  if (params.replyTo) {
    message.replyTo = [{ emailAddress: { address: params.replyTo } }];
  }

  try {
    const client = getGraphClient();
    await client.api(`/users/${MAIL_FROM}/sendMail`).post({ message });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await Promise.all(enqueuedIds.map((id) => markFailed(id, reason)));
    throw err;
  }

  await Promise.all(enqueuedIds.map((id) => markSent(id, "microsoft-graph")));

  console.log(`[email sent] "${params.subject}" to ${toSend.map((r) => r.address).join(", ")}`);
  return true;
}
