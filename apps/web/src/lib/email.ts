import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";

const TENANT_ID     = process.env.AZURE_TENANT_ID ?? "";
const CLIENT_ID     = process.env.AZURE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET ?? "";
const MAIL_FROM     = process.env.MAIL_FROM ?? "";

const configured = !!(TENANT_ID && CLIENT_ID && CLIENT_SECRET && MAIL_FROM);

if (!configured) {
  console.warn("Microsoft Graph email not configured — emails will not be sent.");
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
};

export async function sendEmail(params: SendParams) {
  if (!configured) {
    console.warn(`[email skip] Graph not configured — would have sent "${params.subject}" to ${params.to}`);
    return null;
  }

  const toAddresses = (Array.isArray(params.to) ? params.to : [params.to]).map((address) => ({
    emailAddress: { address },
  }));

  const message: Record<string, unknown> = {
    subject: params.subject,
    body: { contentType: "HTML", content: params.html },
    toRecipients: toAddresses,
  };

  if (params.cc) {
    const ccList = (Array.isArray(params.cc) ? params.cc : [params.cc]).filter(Boolean);
    if (ccList.length > 0) {
      message.ccRecipients = ccList.map((address) => ({ emailAddress: { address } }));
    }
  }

  if (params.replyTo) {
    message.replyTo = [{ emailAddress: { address: params.replyTo } }];
  }

  const client = getGraphClient();
  await client.api(`/users/${MAIL_FROM}/sendMail`).post({ message });

  console.log(`[email sent] "${params.subject}" to ${params.to}`);
  return true;
}
