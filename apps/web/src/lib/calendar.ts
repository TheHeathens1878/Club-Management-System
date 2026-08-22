import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";

const TENANT_ID     = process.env.AZURE_TENANT_ID ?? "";
const CLIENT_ID     = process.env.AZURE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET ?? "";
// Calendar writes use CALENDAR_USER; falls back to MAIL_FROM (same mailbox)
const CALENDAR_USER = process.env.CALENDAR_USER ?? process.env.MAIL_FROM ?? "";

const configured = !!(TENANT_ID && CLIENT_ID && CLIENT_SECRET && CALENDAR_USER);

if (!configured) {
  console.warn("Microsoft Graph calendar not configured — calendar sync will be skipped.");
}

function getGraphClient(): Client {
  const credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"],
  });
  return Client.initWithMiddleware({ authProvider });
}

export async function createCalendarEvent(params: {
  date: string;
  start_time: string;
  end_time: string;
  room_name: string;
  booker_name: string;
  occasion: string | null;
  estimated_guests: number | null;
}): Promise<string | null> {
  if (!configured) return null;
  try {
    const start = `${params.date}T${String(params.start_time).slice(0, 5)}:00`;
    const end   = `${params.date}T${String(params.end_time).slice(0, 5)}:00`;
    const bodyLines = [
      `Booker: ${params.booker_name}`,
      params.occasion ? `Occasion: ${params.occasion}` : null,
      params.estimated_guests ? `Expected guests: ${params.estimated_guests}` : null,
    ].filter(Boolean).join("\n");

    const client = getGraphClient();
    const event = await client.api(`/users/${CALENDAR_USER}/calendar/events`).post({
      subject: `${params.room_name}${params.occasion ? ` — ${params.occasion}` : ""}`,
      start: { dateTime: start, timeZone: "Europe/London" },
      end:   { dateTime: end,   timeZone: "Europe/London" },
      location: { displayName: params.room_name },
      body: { contentType: "Text", content: bodyLines },
      showAs: "busy",
    });
    console.log(`[calendar] Created event ${event.id} for ${params.date}`);
    return event.id ?? null;
  } catch (e) {
    console.error("[calendar] Failed to create event:", e);
    return null;
  }
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  if (!configured || !eventId) return;
  try {
    const client = getGraphClient();
    await client.api(`/users/${CALENDAR_USER}/calendar/events/${eventId}`).delete();
    console.log(`[calendar] Deleted event ${eventId}`);
  } catch (e) {
    console.error("[calendar] Failed to delete event:", e);
  }
}
