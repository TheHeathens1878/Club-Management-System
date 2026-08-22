# Payments, Booker Portal & SumUp — Design

Status: **Design (pre-build)** · Target: SumUp **sandbox** first · Scheduler: **Vercel Cron**

This document is the build spec for: multiple-payment tracking, staff names on
authorisation timestamps, a self-service **Booker** portal with deposit/balance
flow, **SumUp** online payments, and scheduled reminder emails.

---

## 1. Goals (from the brief)

1. Track **multiple payments** per booking, each with amount, date, method,
   reference, and a timestamp of the **staff member who authorised it** (by name).
2. **Email the booker** confirming each payment → new email template.
3. Staff/admin users get a **Name** alongside their email; that name appears in
   authorisation timestamps.
4. **Booker portal + SumUp**:
   - Booker books a room → an **account is created** for them (new `booker` role).
   - Staff **confirm** the room and set the **total cost**.
   - Booker receives confirmation **subject to a £100 deposit within 7 days**
     (deposit amount **and** window must be editable).
   - Booker logs into their **portal** and pays deposit / full amount (SumUp).
   - **14 days before** the booking they get a **balance reminder** email if not
     paid in full (the 14 days must be editable).

---

## 2. Data model

### 2.1 New table — `booking_payments`

One row per payment. Replaces the single `payment_*` columns on `room_bookings`
(those are migrated in, then left read-only / dropped later).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `booking_id` | uuid not null | → `room_bookings(id)` on delete cascade |
| `amount_pence` | integer not null | the payment amount |
| `paid_at` | timestamptz not null | default `now()`; editable date the money was received |
| `method` | text | `cash` \| `card` \| `bank_transfer` \| `sumup` \| `other` |
| `reference` | text | optional receipt / bank ref |
| `source` | text not null | `manual` \| `sumup` (default `manual`) |
| `sumup_checkout_id` | text | SumUp checkout id (sumup rows only) |
| `sumup_txn_code` | text | SumUp transaction code (sumup rows only) |
| `authorised_by_profile` | uuid | → `profiles(id)`; null for self-serve SumUp |
| `authorised_by_name` | text | **snapshot** of staff name at time of entry |
| `authorised_by_email` | text | snapshot |
| `note` | text | free text |
| `created_at` | timestamptz not null | default `now()` |

**Derived figures** (computed, never stored stale):
- `paid_pence` = `sum(amount_pence)` for the booking.
- `outstanding_pence` = `total_pence − paid_pence`.
- `deposit_satisfied` = `paid_pence >= deposit_pence`.

### 2.2 `room_bookings` additions

| Column | Type | Notes |
|---|---|---|
| `total_pence` | integer | total cost, set by staff at confirmation |
| `deposit_pence` | integer | required deposit; prefilled from settings, editable per booking |
| `deposit_due_date` | date | set at confirmation = confirm date + `deposit_window_days` |
| `balance_due_date` | date | = booking `date` − `balance_reminder_days` |
| `booker_profile_id` | uuid | → `profiles(id)`, the auto-created booker account |
| `deposit_reminder_sent_at` | timestamptz | cron idempotency flag |
| `balance_reminder_sent_at` | timestamptz | cron idempotency flag |

`payment_status` stays but is **derived/maintained** as one of
`unpaid | deposit_paid | paid_in_full` after each payment write.

### 2.3 Migration of existing payment data

For any `room_bookings` row with `payment_received_at` set, insert one
`booking_payments` row (`source='manual'`, amount = `amount_pence`,
`authorised_by_name` parsed from `payment_received_by`). Keep old columns for one
release, then drop in a later migration.

### 2.4 Settings (KV — no migration)

New `site_settings` keys, surfaced in a new **Settings → Payments** tab:

| Key | Default | Meaning |
|---|---|---|
| `deposit_default_pence` | `10000` | default deposit (£100) |
| `deposit_window_days` | `7` | days after confirmation the deposit is due |
| `balance_reminder_days` | `14` | days before booking the balance reminder fires |
| `currency` | `GBP` | fixed for now |

---

## 3. Roles & auth

### 3.1 New role `booker`

- Add `booker` to the `user_role` enum (migration; remember the two-step enum
  commit pattern from `0018`).
- Lowest-privilege **authenticated** role. **Not** staff. Helpers in `src/lib/auth.ts`:
  - `isStaff()` — unchanged (does **not** include booker).
  - new `isBooker(role)` → `role === 'booker'`.
- Hierarchy: `super_user > committee > bar_manager > bar > booker > member`.
- `(app)` layout: bookers must **not** see Bookings/Bar/Settings nav. They are
  redirected to the booker portal.

### 3.2 RLS / access pattern

Existing code reads via the **service-role admin client** with server-side role
checks. The booker portal follows the same pattern: portal server components/
actions use the admin client and **filter by `booker_profile_id === session.userId`**.
Add RLS policies on `room_bookings` + `booking_payments` (booker can `select`
their own rows) as defence-in-depth.

---

## 4. Flows

### 4.1 Booking submit → account creation

In `src/app/book/actions.ts` `submitBooking`, after the booking insert:

1. Look up an existing auth user by `booker_email`.
2. If none, `admin.auth.admin.createUser({ email, email_confirm: true,
   user_metadata: { needs_password: true, full_name: "<first last>" } })` and
   upsert a `profiles` row with `role: 'booker'`. (Reuses the existing
   `needs_password` → `/auth/set-password` flow.)
3. Set `room_bookings.booker_profile_id`.
4. Send the booker a "request received + set your password to track it" email
   (extend existing received template with a portal CTA + set-password link).

Notes:
- If the email already belongs to a staff/member account, **link** to it; do not
  downgrade their role.
- The current **Stripe-at-submit** checkout in `submitBooking` is **removed** —
  bookings are requests; money is taken later in the portal via SumUp.

### 4.2 Staff confirmation (sets total + deposit)

On the booking detail page, the confirm action gains **Total cost** and
**Deposit** inputs (deposit prefilled from `deposit_default_pence`). Confirming:

- sets `status='confirmed'`, `total_pence`, `deposit_pence`,
  `deposit_due_date = today + deposit_window_days`,
  `balance_due_date = booking.date − balance_reminder_days`.
- sends the **updated** `room_booking_confirmed` email: total cost, deposit
  required, deposit deadline, and a **portal login link**, with explicit
  "confirmed subject to a deposit of {{deposit}} by {{deposit_due_date}}" wording.

### 4.3 Booker portal — `/portal`

Authenticated booker area:
- Lists their bookings with status, total, paid, outstanding, deposit due date,
  balance due date.
- Buttons: **Pay deposit** (when deposit unpaid), **Pay balance** / **Pay in
  full** → SumUp checkout for the relevant amount.
- After a successful payment: a `booking_payments` row (`source='sumup'`) +
  `payment_received` email + updated `payment_status`.

### 4.4 Payments (staff, manual)

Booking detail page **Payments** card:
- Table of all `booking_payments` (amount, date, method, ref, authorised-by name,
  source badge).
- "Record payment" form (amount, date, method, reference, note) → `addPayment`.
- Running totals: Total / Paid / Outstanding, deposit-satisfied indicator.
- Delete a **manual** payment: committee+. SumUp rows are locked.
- Each manual payment also triggers the `payment_received` email (toggle to skip).

---

## 5. SumUp integration (sandbox)

Ref: <https://developer.sumup.com/online-payments/sdks/nodejs>

- New `src/lib/sumup.ts`: OAuth client-credentials token, create checkout, fetch
  checkout status. Env-driven so sandbox→live is a config flip.
- **Env vars**: `SUMUP_CLIENT_ID`, `SUMUP_CLIENT_SECRET`, `SUMUP_MERCHANT_CODE`,
  `SUMUP_ENV=sandbox`.
- **Checkout creation**: amount (deposit/balance/full), `currency=GBP`,
  `checkout_reference = "<booking_id>:<purpose>"`, `redirect_url` →
  `/portal/pay/return`.
- **Confirmation**: prefer a **webhook** (`/api/sumup/webhook`) to record the
  payment server-side; also verify on the return URL by fetching checkout status
  (belt-and-braces, idempotent on `sumup_checkout_id`).
- Recommend **hosted redirect** checkout for the sandbox MVP; embedded widget can
  come later.
- **Open item to confirm:** exact SumUp Online Payments product + sandbox
  credential availability for this merchant (hosted checkout vs. card widget).

---

## 6. Email templates

In `src/lib/template-engine.ts` (`TemplateKey` + `TEMPLATE_DEFINITIONS`):

| Key | Status | Trigger | Key variables |
|---|---|---|---|
| `room_booking_confirmed` | **update** | staff confirm | + `total_cost`, `deposit_amount`, `deposit_due_date`, `portal_url` |
| `payment_received` | **new** | each payment | `amount_paid`, `total_paid`, `outstanding`, `method`, `portal_url` |
| `balance_reminder` | **new** | cron, 14d before | `outstanding`, `balance_due_date`, `portal_url` |
| `deposit_reminder` | **new** | cron, deposit due/overdue | `deposit_amount`, `deposit_due_date`, `portal_url` |

All editable in **Settings → Email Templates** like the existing ones.

---

## 7. Scheduled reminders (Vercel Cron)

- `vercel.json` → daily cron hitting `GET /api/cron/payment-reminders`.
- Route guarded by `Authorization: Bearer ${CRON_SECRET}` (env var).
- Logic (idempotent via the `*_reminder_sent_at` flags):
  - **Deposit**: confirmed, deposit unpaid, `deposit_due_date` within window and
    `deposit_reminder_sent_at IS NULL` → send `deposit_reminder`, stamp.
  - **Balance**: confirmed, not paid in full, `balance_due_date <= today` (or ==)
    and `balance_reminder_sent_at IS NULL` → send `balance_reminder`, stamp.
- Note: Vercel Cron requires the project's plan to permit cron jobs.

---

## 8. Staff names

- **Invite** (`super-users/actions.ts` `inviteUser`): add a `name` arg; store via
  `user_metadata.full_name` and on the upserted `profiles` row.
- **Users tab** (`users-client.tsx`): show name next to email; inline edit → new
  `updateUserName(profileId, name)` action.
- **Authorisation timestamps**: `addPayment` snapshots
  `session.profile.full_name` into `authorised_by_name` (falls back to email).

---

## 9. Build phases

- **Phase 1 — DONE.** Payments table, payments UI, payment_received email, staff names, Settings → Payments.
- **Phase 2 — DONE.** Booker role, account-on-booking, confirm with total/deposit, `/portal` (mock pay).
- **Phase 3 — DONE & VERIFIED in sandbox.** `src/lib/sumup.ts` (API-key or OAuth auth),
  checkout creation + card-widget flow, `/api/sumup/webhook`, `/portal/pay/return`. Falls back to
  the mock pay when `SUMUP_*` env vars are absent. Verified end-to-end with sandbox merchant
  `MVE55S27` + `SUMUP_API_KEY`. **To go live:** swap the sandbox `SUMUP_API_KEY`/merchant code for
  live values in Vercel and redeploy. (Webhook is optional — the widget-finalize + return-URL
  paths already record payments idempotently.)
- **Phase 5 — DONE.** Auto-cancel unpaid-deposit bookings (cron sweep, toggle in Settings →
  Payments) — cancels the day after the deposit deadline, emails the booker, removes the calendar
  event. Configurable email recipients (Settings → Notifications) for booking requests,
  cancellations, and auto-cancellations via `getRecipientEmails` (falls back to super users +
  committee). `sendEmail` gained `cc` support. Replaced the legacy member-based
  `getNotificationEmails`.
- **Phase 4 — DONE.** `vercel.json` daily cron (09:00 UTC) → `/api/cron/payment-reminders`
  (guarded by `CRON_SECRET`). Deposit reminder (due within 2 days / overdue, deposit short) and
  balance reminder (balance_due_date reached, not paid in full), idempotent via the
  `deposit_reminder_sent_at` / `balance_reminder_sent_at` flags. New editable `deposit_reminder`
  and `balance_reminder` templates. **To activate:** set `CRON_SECRET` in Vercel and redeploy.

### Original detail

1. **Phase 1 — Payments + staff names** (no external deps)
   - Migration: `booking_payments`, `room_bookings` columns, data migration.
   - Payments UI on booking detail; `addPayment`/`deletePayment`; derived totals.
   - `payment_received` email template + send.
   - Staff name capture (invite + users tab) + name in timestamps.
   - Settings → Payments tab (deposit defaults / windows).
2. **Phase 2 — Booker role + confirmation + portal (mock pay)**
   - `booker` enum + auth helpers + layout redirects + RLS.
   - Account creation on submit; remove Stripe-at-submit.
   - Confirm-with-total/deposit; updated confirmed email.
   - `/portal` with a temporary "mark as paid" stand-in for SumUp.
3. **Phase 3 — SumUp sandbox** replaces the mock pay (checkout + webhook + return).
4. **Phase 4 — Vercel Cron** deposit/balance reminders + their templates.

---

## 10. Decisions still to confirm

1. **Every** booking creates a booker login (incl. one-off guests)? Brief says
   yes — confirm we're happy emailing every booker a set-password link.
2. SumUp **Online Payments** product is enabled for this merchant and **sandbox
   credentials** are obtainable (needed before Phase 3).
3. On confirmation, is **deposit always required**, or should staff be able to
   waive it / take full payment only? (Default: deposit prefilled, editable to £0.)
4. Manual vs SumUp **refunds** out of scope for v1? (Assume yes — record-only.)
5. Keep the half-wired **Stripe** code, or remove it once SumUp lands? (Assume
   remove at Phase 3.)
