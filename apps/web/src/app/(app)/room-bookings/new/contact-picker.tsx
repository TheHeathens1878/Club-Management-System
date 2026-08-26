"use client";

/**
 * "Book for an existing customer" — picks a row from the room's own contacts
 * book (booking_contacts) and fills the customer fields. A convenience only:
 * the form posts the filled values, never the contact id, and the action
 * re-links the booking to the contact by email.
 */

export type ContactOption = {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
};

function fill(id: string, value: string) {
  const input = document.getElementById(id);
  if (input instanceof HTMLInputElement) input.value = value;
}

export function ContactPicker({ contacts }: { contacts: ContactOption[] }) {
  if (contacts.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <label htmlFor="existing-contact" className="text-sm font-medium">
        Existing contact
      </label>
      <select
        id="existing-contact"
        defaultValue=""
        onChange={(event) => {
          const contact = contacts.find((option) => option.id === event.target.value);
          if (!contact) return;
          fill("booker_first_name", contact.first_name);
          fill("booker_last_name", contact.last_name);
          fill("booker_email", contact.email ?? "");
          fill("booker_phone", contact.phone ?? "");
        }}
        className="min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm lg:min-h-0"
      >
        <option value="">Start from a previous hirer…</option>
        {contacts.map((contact) => (
          <option key={contact.id} value={contact.id}>
            {contact.name}
            {contact.email ? ` · ${contact.email}` : ""}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        From the room&apos;s own contacts book — hirers are kept out of the members database.
      </p>
    </div>
  );
}
