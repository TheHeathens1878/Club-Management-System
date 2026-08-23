# P6.4 — store readiness (draft for Adam's review)

Status: drafted 2026-08-23. **The privacy policy below is a draft that Adam
must review with the club's committee (and ideally the Club Welfare Officer)
before it is published** — it describes the processing of children's data and
messaging, which SAFEGUARDING.md and PLAN.md both flag for human review.

## 1. Assets

- App icon / adaptive icon / splash: `apps/mobile/assets/` (placeholders from
  the Expo scaffold). Replace with the club crest (1024×1024 PNG, no alpha for
  iOS) and a splash on the club colour; `app.config.ts` already points at
  them.
- Name: "AoM Sports Club". Bundle ids `uk.co.aomsportsclub.club`
  (`.development` / `.preview` variants). Scheme `aomclub`.

## 2. Privacy policy (draft)

**Who we are.** Ashton-on-Mersey Sports Club ("the club") operates this app
for its members, players, parents/guardians, coaches and staff. The club is the
data controller. Contact: [club secretary email].

**What we collect.**
- Account: name, email, phone (optional), date of birth (used to determine
  whether a member is under 18 and to apply the club's safeguarding rules).
- Membership and playing: teams, seasons, registrations, availability for
  fixtures, subscriptions and payments (payments are processed by Stripe; we
  store amounts, dates and Stripe references, never card numbers).
- Guardianship: which adults are the guardians of which children, recorded at
  registration, and the consents those guardians give (app account,
  unsupervised messaging for 14+, photo consent by purpose).
- Messaging: messages, attachments and read receipts in club conversations.
- Photos and videos: media uploaded by club staff, and who is pictured in it.
- Device: a push-notification token when you enable notifications.
- Safeguarding: concerns reported through the app and the club's case notes.

**Why, and the legal basis.** To run the club's teams, fixtures, bookings and
subscriptions (contract/legitimate interests); to meet the club's safeguarding
duties under FA and Cheshire FA policy (legal obligation / substantial public
interest); photos only with consent; marketing messages only with consent.

**Children.** Members under 18 may hold an app account only from the age set by
the club (currently 13) and only with a guardian's consent. The app enforces
the club's safeguarding rules in its database: an adult and a child cannot be
alone in a private conversation unless the adult is that child's guardian or,
for children of 14 and over whose guardian has consented, the conversation is
flagged as visible to the club's safeguarding lead. **Conversations involving a
child can be opened and exported by the club's safeguarding lead or
administrators; every such access is recorded.** A banner in the conversation
tells every participant when this applies. Photos of a child are shown or
exported only where that child's guardian has consented for that purpose.

**Sharing.** Supabase (hosting and database, EU region), Stripe (payments),
Resend (email), Twilio (SMS, only if you opt in), Expo (push notifications),
the FA's Full-Time service (fixtures are imported from public pages; nothing
about you is sent to it). The club does not sell data.

**Retention.** Membership records are kept while you are a member and for
[24 months] after; messages for [24 months]; safeguarding records for the
period required by FA guidance; audit records for 7 years. Anything under a
safeguarding legal hold is kept until the hold is lifted. *(Periods in
brackets are placeholders — SAFEGUARDING.md D7 — and must be confirmed.)*

**Your rights.** Access, correction, deletion (subject to safeguarding and
legal-hold exceptions), objection, portability; complaints to the ICO.
Guardians exercise rights on behalf of children; from 18 the member does.

## 3. Apple App Store — App Privacy answers

| Data | Collected | Linked to identity | Used for tracking |
|---|---|---|---|
| Name, email, phone, DOB | yes | yes | no |
| Payment info (via Stripe) | yes (amounts/refs) | yes | no |
| Photos/videos | yes (staff uploads) | yes | no |
| Messages | yes | yes | no |
| Device ID (push token) | yes | yes | no |
| Location / contacts / health | no | — | — |

Age rating: 4+ content; but the app handles children's data — declare "Made
for Kids: No" (it is a club-membership app used by adults and supervised
teens) and complete the Kids/COPPA questions accordingly.

## 4. Google Play — Data safety

Collected: name, email, phone, DOB, payment info (via third party), photos,
messages, device/other IDs. Shared: with the processors listed above. Data is
encrypted in transit; users can request deletion via the club. Account
deletion URL: [web app URL]/settings (to be added — required by Play policy).

## 5. EAS Submit

```
eas build --profile production --platform all
eas submit --platform ios      # needs App Store Connect API key or Apple ID
eas submit --platform android  # needs a Google service account JSON
```
TestFlight internal group + Play internal track for club testers (P6.4
acceptance). Credentials are Adam's (Apple Developer Program, Play Console).
