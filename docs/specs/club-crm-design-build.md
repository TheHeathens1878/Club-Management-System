# Club CRM — design build specification

Source: the Claude Design mockup `sidebar-design.html` (sidebar + 11 screens) and the earlier
direction sheet `crm-directions.html`. Team page direction chosen: **2b, matchday-led**.
A build checklist, not a visual spec — colours, fonts and spacing come from the mockup as-is.

Palette/type from the mockup: near-black `#14100E`, crest orange `#E14A25`/`#C23D1C`, paper
`#F7F4F0`, muted `#7A716B`, green `#3F7D5C`, amber `#B4711A`/`#8F5A14`. Oswald condensed caps for
headings and eyebrows; Source Sans 3 for data.

---

## 1. Sidebar & navigation

### 1.1 Header
Crest (`assets/crest.png`, 30px) + **AoM Sports Club** (Oswald 600 uppercase 12.5px) on line 1;
signed-in person's name (**Adam Rowley**) on line 2 (11px, 55% opacity). Rule beneath.

### 1.2 "Viewing as" role panel
Tile: eyebrow **VIEWING AS**, active `roleLabel` on line 1, `roleScope` on line 2,
`ChevronsUpDown` icon; orange tint + orange border; click toggles.
Open panel: dropdown below the tile, header **Switch role**, one row per role held.
Each option is **two lines** — role (600 weight when active, 400 otherwise) over scope (muted) —
with a `✓` tick in crest orange on the right of the active row only, and an orange-tinted
background on that row.

Roles in the mockup (`ROLES`), showing multiple hats per person:

| Role | Scope | kind |
|---|---|---|
| Club admin | Whole club | admin |
| Coach | U14 Mavericks | coach |
| Parent | U14 Mavericks | parent |
| Coach | U18 Cobras | coach |
| Parent | U18 Cobras | parent |
| Player | O45 Men | player |

**Hard scoping rule** (the design's own comment): `views` is a HARD scope — the chosen role view
shows its own items and nothing else, no unioning of the hats one person wears.
Picking a role sets screen to `overview` for admin and `lobby` for every other kind, and clears the
stub label. A role switch must never leave you on a page your view can't reach: if the current
screen is not in `SCREEN_VIEWS[screen]` for the new view, fall back to `lobby`.

### 1.3 Nav groups and items (`GROUPS`)
Icons are lucide names. "Views" is the hard role scope. `stub:` items keep their existing routes and
are **not** redesigned in this pass.

| Group | Item | Icon | Views | Badge | Built? |
|---|---|---|---|---|---|
| Club | Club lobby | Armchair | all | — | built |
| Club | Messages | MessageSquare | all | `12` orange | built |
| Club | My teams | Shirt | player | — | stub |
| Club | Children | Baby | parent | — | stub |
| Club | Overview | LayoutDashboard | admin | — | built |
| Club | Teams | Users | coach, admin | — | built |
| Club | People | Contact | admin | — | built |
| Club | Waiting list | ClipboardList | coach, admin | `18` orange | stub |
| Club | Approvals | UserCheck | admin | `6` orange | stub |
| Club | Registrations | ClipboardCheck | admin | — | stub |
| Matchday | Matches | Shirt | coach, admin | — | built |
| Matchday | Events | CalendarCheck | player, parent | — | stub |
| Matchday | Training | CalendarCheck | coach, admin | — | built |
| Matchday | Social | CalendarDays | all | — | built |
| Pitches | Pitch calendar | CalendarDays | all | — | stub |
| Pitches | Book a pitch | CalendarPlus | coach, admin | — | stub |
| Pitches | Allocate fixtures | LandPlot | admin | — | stub |
| Pitches | Pitch requests | Inbox | admin | `3` white-translucent | stub |
| Function room | Room bookings | DoorOpen | admin | — | stub |
| Function room | Bar | Beer | admin | — | stub |
| Money | Subs | Receipt | admin | — | built |
| Money | My subs | Wallet | all | — | stub |
| Safeguarding | Safeguarding | ShieldAlert | admin | — | stub |
| Safeguarding | Report a concern | ShieldAlert | all | — | stub |
| Settings | Settings | Settings | admin | lock glyph (`adminOnly`) | built |
| Settings | Comms preferences | Mail | all | — | stub |

- `Report a concern` is in **every** view by design (comment SG-3: "a menu that hides it is a menu
  that loses the report").
- `adminOnly: true` renders a small `Lock` on the right of the row (Settings only).
- A group with no visible items for the current view is not rendered.
- Active item: orange background, white text, 600 weight. `team` marks `teams` active; a stub marks
  its own `stub:<label>` item.
- Footer: `LogOut` icon + **Sign out**, pinned to the bottom.

### 1.4 Screen guards (`SCREEN_VIEWS`)
`lobby`, `messages`, `social`, `stub` → all · `overview`, `people`, `subs`, `settings` → admin ·
`teams`, `team`, `matches`, `training` → coach + admin. Each page carries its own guard; nav scoping
mirrors it, it does not replace it.

### 1.5 Stub screen
Dashed card: eyebrow **EXISTING ROUTE**, item label as heading, body "This page exists in the app
but isn't part of this pass." Use for every `stub:` route until redesigned.

---

## 2. Per-screen specs

### 2.1 Club lobby (`lobby`) — all views
Dark full-bleed header: crest 58px; eyebrow "Monday 25 August · the club is open until 23:00"; H2
**Club lobby**; sub "Everything happening across Ashton-on-Mersey this week — one place everyone can
see." Buttons *Book the room* (outline), *Post to the lobby* (orange). Body: 1.5fr / 1fr.

**Club noticeboard** (left) — header rule "Everyone can read · admins and coaches can post".
Pinned post (orange tint): **PINNED** eyebrow, "Rachel Doyle, Chair · 22 Aug", headline "The 3G
pitch is closed for resurfacing, 2–9 September", body, counters "487 read" / "14 replies". Then
"Adam Rowley, Secretary · 20 Aug — Autumn subs are open in the app · 512 read · 6 replies" and
"Jo Whitfield, Minis coordinator · 18 Aug — We need four more volunteers for the minis festival ·
334 read · 9 replies". Author line is **name + club role**, not just a name.

**Last weekend across the club** (left) — rule "Results pulled from FA Full-Time"; 2-column grid of
team (bold) / opponent (muted) / result badge `W 4–1` green, `D 17–17` muted, `L 0–3` orange; last
cell is the link **All 14 results**.

**On this week** (right) — coloured left-bar list: "Quiz night · Friday 20:00 — 11 teams entered ·
£3 a head, bar open late"; "Minis festival · Sunday 10:00 — Six clubs, pitches 1–4 · 4 volunteers
needed"; "Volunteer BBQ · Sunday 13:00 — 31 attending · terrace, free entry"; "Function room booked
Friday — Hayes wedding · bar staffed from 18:00". Bar colours: green social, orange matchday, purple
room hire.

**Lend a hand** (right) — eyebrow + pill "6 open"; rows with an action chip: "Car park marshal ·
Sunday → *I'll do it*"; "Refreshment table · Sunday → *I'll do it*"; "U16 Blacks need a manager →
*Ask more*"; "Quiz night raffle prizes → *Offer one*".

**New to the club** (right) — three avatar rows, name + "team · joined month" (Aisha Rahman — U12
Reds · joined July; Priya Nair — Netball section · joined August; Steve Naylor — Rugby Colts coach ·
joined August); footer "Say hello on the noticeboard — it makes a difference in the first few
weeks."

*Data mapping* — noticeboard: `board_posts` / `board_replies` / `board_reads` via
`club_lobby_posts()`, `create_board_post()`, `mark_board_posts_read()`, `set_board_post_pinned()`
(landed in working-tree migration `20260824400000_board.sql`, see §3). Results: `fixtures` (FA
Full-Time). On this week: `events` + `bookings` + `event_responses`; room hire from
`bookings`/`room_bookings`. New to the club: `people` + `team_memberships.joined_at`.
**No backing:** "Lend a hand" volunteer slots and the "4 volunteers needed" counts; the merged
"On this week" feed as a public-safe view; the new-members list (and its privacy decision — it names
members, including a child, to every signed-in view).

### 2.2 Club overview (`overview`) — admin
Header: eyebrow "Season 2026/27 · Week 4", H2 **Club overview**, buttons *Post a notice* (outline),
*New message* (orange).

Counter tiles: **Registered players** 612 "+34 this month" (green) · **Teams active** 31 "24
football · 7 rugby" · **Subs collected** £41,280 with a 78% progress bar · **In arrears**
(orange-bordered) £3,145 "47 members · 9 over 60 days".

**This weekend · Sat 29 – Sun 30 Aug** (1.35fr) — link *All fixtures* → matches. Columns: day/time |
fixture + "competition · home/away" | pitch | status pill. Rows: U12 Reds v Sale United, League ·
Home, Pitch 3 (9v9), `14 available` green · U14 Blacks v Timperley, Cup R1 · Home, `Unallocated`
amber, `9 of 16` amber · Rugby Colts v Broughton Park, Friendly · Home, Main pitch, `21 available` ·
Minis festival · U7–U9, Club event · 6 clubs invited, Pitches 1–4, `Volunteers 4` grey.

**Needs you** (1fr) — coloured left-bar list, some rows clickable: "6 account requests awaiting
approval — Oldest 4 days · 2 are guardians" (red) · "U14 Blacks cup tie has no pitch — Kick-off in 4
days" (red) · "9 members over 60 days in arrears — £1,120 · reminders last sent 12 Aug" (amber) →
subs · "Presentation night — 62 replies — Room capacity 120 · closes Fri" → social · "3 pitch hire
requests from outside clubs — £360 potential income".

*Data mapping* — `people`, `team_memberships`, `teams`, `seasons`; `subscriptions` + `payments`;
`fixtures`, `bookings`, `allocate_fixture()`; `availability` / `booking_availability` /
`event_responses`; `account_requests`; `events` + `event_responses`. Pitch hire requests: UNCLEAR
which table holds an outside-club request — check the pitch-requests stub route.
**No backing:** every counter is an aggregate with no view/RPC today; "Volunteers 4"; the "+34 this
month" trend; "reminders last sent" (see chase trail, §4).

### 2.3 Teams (`teams`) — coach, admin
Header: eyebrow "31 teams · Season 2026/27", H2 **Teams**, button *Add a team*.
Filters: search "Search teams"; chips **All sports** (active), **Football 24**, **Rugby 7**,
**Needs staff 3**.
Table **Team | Staff | Squad | Next out | Subs**:
- Team: name + "sport · format · league" ("Football · 9v9 · Timperley & District").
- Staff: manager + "+ 2 assistants"; a team with none shows **No manager** in orange over "1
  assistant".
- Squad: "16 players"; U9 Minis adds "18 on waiting list" in orange.
- Next out: "Sat 09:30 / v Sale United"; U14 Blacks shows "no pitch yet" amber.
- Subs pill: `All paid` green / `4 owing` amber / `7 owing` orange.
- Row click opens the team page (`goTeam`, landing on Matchday).

*Data mapping* — `teams`, `team_memberships` (player/coach/manager roles), `seasons`, `fixtures`,
`bookings`, `subscriptions` + `payments`, `waiting_list_entries`.
**No backing:** "Needs staff" as a stored flag (derivable); sport/format/league labels if `teams`
lacks those columns — UNCLEAR, verify the `teams` schema.

### 2.4 Team (`team`) — coach, admin
Sub-header: back link "← Teams"; eyebrow "Football · 9v9 · Timperley & District"; H2 **U12 Reds**;
buttons *Post to board* (outline), *Message squad* (orange).
Tabs (`TEAM_TABS`): **Matchday | Communications | Squad | Training | Subs** (ids `matchday`,
`board`, `squad`, `training`, `subs`); Matchday is default.

**Matchday tab.** Dark band: eyebrow "Next match · in 4 days"; "U12 Reds **v** Sale United";
"Sat 29 Aug · 09:30 · Pitch 3 (9v9) · League · Referee J. Ogden"; right-hand **14/16** over
"available" and the orange *Pick the team* button.
*Availability card* — header pill **"Chase the 1 no-reply"**; stacked bar 87.5% green / 6.25% orange
/ 6.25% grey; legend "14 available · 1 away · 1 no reply"; player rows (avatar, name, coloured
status): Ellie Docherty Available, Harry Bell Available, Fin Ashworth Away, Tia Ward No reply, Mo
Chowdhury Available; footer link "Show all 16 in the squad" → Squad tab.
*Matchday jobs card* — header + "2 of 4 filled"; "Barrier · 2 needed → Paul Bell +1" (green);
"Refreshments → Nobody yet" (amber); "Nets and flags → Dan Kelly"; "Lift share for Fin → Nobody
yet".
*Bulletin board card* (right) — header + link "All posts" → Communications. Pinned "Saturday: meet
08:45 at the clubhouse" (Dan Kelly · 21 Aug) with "41 of 46 read" / "6 replies"; compact rows "New
training tops have arrived — Jo Whitfield · 38 of 46 read" and "Autumn subs are now due —
**Club-wide** · 44 of 46 read".
*Team chat card* (right) — header + unread badge `3`; three bubbles (incoming white left, own dark
right) captioned "Name · HH:MM"; composer "Message the U12 Reds group…" + *Send*.

**Communications tab (`board`).** Left: **Bulletin board**, rule "Visible to squad, parents and
staff", the three posts in full — the pinned one carries an **Unpin** action beside its counters;
the club-wide one carries a grey **Club-wide** chip beside the author line and a read count with no
reply count. Below: **Squad · 16 players**, header link "Availability for Sat 09:30", two-column
availability list, final cell "Show all 16". Right: **Team chat** (rule "Staff & parents · 3
unread", same bubbles + composer) and **Team at a glance** — Squad "16 players · 46 contacts"; Subs
"16 of 16 paid" green; Training "Mon 18:00 · Pitch 2"; Attendance "87% this term"; Photo consent "2
without" amber.

**Squad tab.** Chips **All 16** (active), **Needs chasing 3** (amber), **No consent 2**; right note
"Availability shown for Sat 29 Aug, 09:30". Player cards 4-across: avatar, name, "Age 12 · midfield"
(age · position), then up to three labelled rows chosen per player — **Saturday** (Available / Away
/ No reply), **Subs** (Paid / £45 owing), **Attendance** (%), or **Consent** (No photos) in place of
Attendance. Footer note under a rule: "Sarah Docherty · early pickup Sat", "Paul Bell · volunteers
on matchdays", "Kate Ashworth · needs a lift share", "Only keeper in the squad", "Two guardians on
the record", "Joined in July". Action cards are border-tinted: orange (Fin Ashworth — Away, No
photos), amber (Tia Ward — No reply, £45 owing, 74%) with chips **Chase both** / **Open**. Final
dashed card "Show the other 9 / 16 players in the squad".

**Training tab.** Left **Sessions**, rule "Mondays, 18:00 · Pitch 2", columns **Date | Focus | Coach
| Attended**: Mon 31 · Set pieces · Dan Kelly · `Upcoming` (row highlighted); Mon 24 · Pressing
shape · `14/16`; Mon 17 · Finishing · Jo Whitfield · `15/16`; Mon 10 · Small-sided games · `11/16`
amber; Mon 3 · Fitness · pre-season · `16/16`. Right **Take the register** ("Mon 31 Aug · 18:00 ·
Pitch 2"), one row per player with **Here**/**Out** toggle chips (selected filled green/orange),
footer "4 marked · 12 to go" + *Save register*. Right **Lowest attendance this term**: Tia Ward 74%
amber, Aisha Rahman 81%, Harry Bell 88%; note "Squad average 87%. Nobody has missed three in a row."

**Subs tab.** Tiles: Collected £675 "of £720 billed"; Paid **15/16** "£45 per player, autumn term";
Match fees £112 "£2 a game, 4 games in"; Outstanding £45 amber "1 player · 11 days late".
**Payments by player** — buttons *Record cash* (outline), *Chase the 1 unpaid* (orange); columns
**Player | Billed to | Term subs | Match fees | Method**: Ellie Docherty / Sarah Docherty / `Paid` /
£8 / "Card · 12 Aug"; Fin Ashworth / Kate Ashworth / `Paid` / £6 / "Cash · 14 Aug"; Tia Ward / Marc
Ward / `£45 owing` amber / £4 / "Chased 19 Aug" (row tinted); Mo Chowdhury / Rana Chowdhury /
`Paid` / £8 / "Plan · 3 of 3".

*Data mapping (whole page)* — fixture band: `fixtures` + `bookings` + `my_events()`. Availability:
`availability` / `booking_availability` / `event_responses`. Selection: `selections`. Squad:
`team_memberships` + `people` + `guardianships`. Consent: `guardian_consents` / `media_subjects`.
Chat: `conversations` + `messages` (`ensure_team_conversation()`). Board: `team_board_posts()` /
`board_post_thread()` (§3). Training: `bookings` (kind=training) + `booking_attendance` for the
register and the `n/16` counts. Subs: `subscriptions`, `subscription_plans`, `payments`.
**No backing:** matchday jobs / volunteer slots; player **position** ("midfield", "keeper" —
`team_memberships` carries only `shirt_number` and `notes`); attendance **percentages** (raw marks
exist, no rollup); the "46 contacts" rollup; per-player free-text notes ("early pickup Sat") unless
`team_memberships.notes` is reused; a match-fee ledger distinct from term subs (UNCLEAR whether
`payments.kind` separates it — check `payments_kind_guard`).

### 2.5 Matches (`matches`) — coach, admin
Header: eyebrow "Synced from FA Full-Time · 14 min ago", H2 **Matches**, buttons *Allocate pitches*
(outline), *Add a fixture* (orange). Chips **This weekend** (active), **Next 4 weeks**, **Results**;
right-aligned **2 need a pitch** (orange), **3 short of players** (amber).

**Focus fixture card** (orange border): eyebrow "Sat 29 Aug · 11:00 · Cup round 1"; "U14 Blacks v
Timperley Rangers"; warning "No pitch allocated · referee unconfirmed"; buttons *Chase replies*,
*Allocate pitch*. Split body — left **Availability · 18 asked** with "9 available" amber, bar
50/17/33, legend "9 available · 3 unavailable · 6 no reply", note "Reminder went out Tuesday. Squad
minimum for 11v11 is 11 plus a keeper."; right **Selection so far** as name chips ("Ben Casey · GK",
Ollie Frame, Zak Idris, Callum Reid, Sam Otieno, Rhys Tudor) plus a dashed "+ 5 places" chip, note
"Two U13s can be dual-registered up if numbers stay short."

**Fixture table** — **Kick-off | Fixture | Competition | Pitch | Availability | Referee**: U12 Reds
v Sale United (Home) · League · Pitch 3 (9v9) · `14 of 16` · J. Ogden; Rugby Colts v Broughton Park
(Home · friendly) · Friendly · Main pitch · `21 of 24` · Club ref; Stockport Ladies v Ladies 1st XI
(Away · Woodbank Park) · League · Away · `16 of 19` · Appointed; U16 Blacks v Urmston Meadowside
(Home) · League · `Unallocated` amber · `7 of 15` orange · `None` amber.

*Data mapping* — `fixtures` (+ `import_fixtures`, `fulltime_*`), `bookings` +
`allocate_fixture()` / `allocate_team_fixtures()`, `availability` / `booking_availability` /
`event_responses`, `selections`, `remind_event_nonresponders()` for *Chase replies*.
**No backing:** referee name / appointment status (UNCLEAR — verify `fixtures` columns); the
"dual-registered up" hint; squad-minimum rules per format.

### 2.6 Training (`training`) — coach, admin
Header: eyebrow "Week of 24 August · 19 sessions", H2 **Training**, buttons *Book a pitch*
(outline), *New session* (orange).
**Sessions this week**, rule "Pitch capacity 4 slots per evening", columns **When | Team | Coach |
Where | Attending**: Mon 18:00 U12 Reds · Dan Kelly · Pitch 2 · `14/16`; Mon 19:30 U16 Blacks ·
**Unassigned** (orange) · 3G · `6/15` orange; Tue 18:30 Rugby Colts · Steve Naylor · Main pitch ·
`20/24`; Wed 17:30 U9 Minis · Jo Whitfield · Pitch 4 · `19/22`; Thu 18:00 U14 Blacks · Mark Rowe ·
Pitch 1 · `11/18` amber; Thu 19:30 Ladies 1st XI · Rachel Doyle · 3G · `17/19`.
Right **Take the register** — same mechanics as the team Training tab, scoped "U12 Reds · Mon 18:00
· Pitch 2", footer "11 marked · 5 to go". Right **Attendance this term** bars: U12 Reds 87%, U9
Minis 84%, U14 Blacks 61% amber, U16 Blacks 42% orange; note "U16 has trained without a named
manager for three weeks. Worth a conversation before the season starts."

*Data mapping* — `bookings` (kind=training) + `booking_teams`, `resources`, `team_memberships`
(coach), `booking_attendance`, `pitch_calendar()`.
**No backing:** attendance percentages per team/term; "pitch capacity 4 slots per evening" as a
stored rule; the narrative note.

### 2.7 People (`people`) — admin
Header: eyebrow "1,284 records · 612 players · 498 guardians", H2 **People**, buttons *Export CSV*
(outline), *Add a person* (orange). Filters: search "Name, email, phone or team"; chips
**Everyone** (active), **Players**, **Guardians**, **Coaches**, **Committee**, **Under 18**; right
note "Sorted by surname".
Table **Name | Role | Contact | Teams | Status**:
- Name: avatar, "Surname, Forename", second line varying — "Age 11", "Guardian of Harry Bell",
  "DBS to 03/2028", "DBS expires 11/2026", "Requested access 21 Aug".
- Role: may stack two ("Guardian / Volunteer", "Coach / Committee", "Manager / Guardian") or read
  "Unassigned".
- Contact: for a child "via Kate Ashworth" + the guardian's number; for an adult email + phone.
- Teams: team, optionally "+ U9 Minis". Status pill: `Registered` / `Active` green, `DBS due` amber,
  `Needs review` orange.
- Footer: "Showing 7 of 1,284" and "Contact details for under-18s are shown through their guardian."

*Data mapping* — `people`, `profiles`, `person_roles`, `guardianships`, `team_memberships`,
`certifications` (+ `certification_exemptions`, `due_certification_nudges()`), `account_requests`,
`registrations`, `my_capabilities()`. Guardian-routed contact for minors is already an RLS /
`is_minor` concern — reuse it, do not re-implement client-side.
**No backing:** the header rollups (1,284 / 612 / 498); "Committee" as a filter if `person_roles`
has no such value (UNCLEAR — `is_committee()` exists, verify the role); a CSV export endpoint.

### 2.8 Messages (`messages`) — all views
Two-pane, full height.
**Left list (320px)**: H2 **Messages**, search "Search conversations"; chips **All** (active),
**Teams**, **Direct**, **Unread 12** (orange). Rows: title, timestamp, preview "Sender: text…", and
chips beneath — unread count (orange), member count, or a kind chip. Active row: orange left rule +
tint. Examples: "U12 Reds — parents / 09:41 / Paul Bell: I can do the barrier on Saturday… / `3`
`46 members`"; "Committee / 08:55 / `5` `11 members`"; "Sarah Docherty / Yesterday / `Direct`"; "All
coaches / Fri / `31 members`"; "Function room enquiries / Thu / `Shared inbox`".
**Right pane**: header "U12 Reds — parents", sub-line "46 members · Dan Kelly, Jo Whitfield and 2
admins can post announcements", buttons *Members*, *Mute*. Body: centred date divider "Friday 22
August"; bubbles captioned "Name · HH:MM"; an **Announcement** is styled distinctly (orange left
rule, orange-tinted border, the word "Announcement" in the caption) and carries "Read by 41"
beneath; own messages right-aligned and dark. Composer: "Write to 46 members…", buttons
*Announcement* (outline) and *Send* (orange). Footer notice: "Under-16s in this group see messages
through their guardian's account. All group messages are retained for safeguarding."

*Data mapping* — `conversations`, `conversation_participants`, `messages`, `message_attachments`,
`message_reactions`, `ensure_team_conversation()`, `group_member_counts()`,
`conversation_has_minor()` / `conversation_is_compliant()` for the footer, `enqueue_message()` /
`outbound_messages` for delivery.
**No backing:** the **Announcement** message kind and its per-message **"Read by 41"** receipt;
"Shared inbox" as a conversation kind (UNCLEAR — function-room enquiries may already route through
`booking_comms`).

### 2.9 Subs & payments (`subs`) — admin
Header: eyebrow "Autumn term 2026 · due 1 September", H2 **Subs & payments**, buttons *Record a cash
payment* (outline), *Send reminders* (orange).
Tiles: Collected £41,280 "of £44,425 billed"; Paid by card 548 "17 cash · 9 bank transfer"; On a
plan 31 "Three monthly instalments"; Outstanding £3,145 (orange) "47 members · 9 over 60 days".
**Outstanding by member** — chips **All 47** (active), **60 days+ 9** (orange), **On a plan 31**;
columns **Member | Team | Owed | Last chased | Action**; member cell has a second line ("Bill to
Gemma Hobbs", "On a payment plan", "Hardship request open"). Rows: Liam Hobbs / U14 Blacks / £90 /
"12 Aug · 74 days late" / *Chase*; Zak Idris / £45 / 68 days late / *Chase*; Callum Reid / U16
Blacks / £30 / "Auto · next 1 Sep" / `On plan`; Tia Ward / U12 Reds / £45 / "19 Aug · 11 days late"
/ *Chase*; Sam Otieno / £45 / "Paused" / `Review`.
Right **Collection by team**: U12 Reds 100%, Rugby Colts 100%, U9 Minis 91%, U14 Blacks 78% amber,
U16 Blacks 53% orange. Right **Other income, this month**: Function room hire £1,860; Pitch hire
£360; Bar takings £4,215; Social events £620; **Total in £15,475**.

*Data mapping* — `subscriptions`, `subscription_plans`, `payments`, `memberships` /
`membership_people` (family vs individual), `people` + `guardianships` for "Bill to",
`team_memberships`, `booking_payments` / `room_bookings` for hire income. Provider is SumUp, not
Stripe (`stripe_events` is legacy — confirm before wiring).
**No backing:** "Last chased" timestamps and the chase action; hardship / paused state; bar takings;
the per-team collection rollup.

### 2.10 Social (`social`) — all views
Header: eyebrow "6 events open for replies", H2 **Social**, button *Create an event* (orange).
**Featured event**, split. Left: eyebrow "Saturday 19 September · 19:00 · Function room"; H3
**Presentation night 2026**; description (£8 per head, under-5s free, replies close Friday 5
September); buttons *Message the 58 who haven't replied* (dark), *Edit event* (outline). Right
(tinted): eyebrow **REPLIES**; **62** "of 120 places"; bar at 52%; Attending "62 · £496 taken",
Can't make it 14, No reply 58, Closes "Fri 5 Sep".
**Event cards, 3 across**: date eyebrow, title, blurb, footer count + state — "Volunteer BBQ / 31
attending / Open"; "Quiz night / 11 teams entered / Open"; "Club open day / 4 of 12 volunteers
(amber) / Planning".

*Data mapping* — `events`, `event_series`, `event_responses`, `respond_to_event()`,
`remind_event_nonresponders()` for the "message the 58" action, `event_detail()` / `event_people()`,
`bookings` for the room, `payments` if ticketing is wired.
**No backing:** capacity ("of 120 places") unless `events` carries it (UNCLEAR — verify); ticket
money per event; "11 teams entered" as a non-person count; volunteer counts ("4 of 12 volunteers");
the lifecycle state "Planning".

### 2.11 Settings (`settings`) — admin only
Header: lock icon + eyebrow "Club admin only · 3 people have this"; H2 **Settings**; buttons *View
audit log* (outline), *Save changes* (orange). Tabs: **Roles & access** (active), Season & teams,
Subs & payments, Notifications, Integrations — only Roles & access is designed.

**What each role can do** — sub-line "Roles are assigned per person on their record. Changes take
effect at their next sign-in."

| Capability | Admin | Manager | Parent | Player 13+ |
|---|---|---|---|---|
| See full contact details | Yes | Own team | No | No |
| Post to a bulletin board | Yes | Own team | Reply only | Reply only |
| Direct-message an adult | Yes | Yes | Yes | **Never** |
| Set availability | Yes | Yes | For child | Own only |
| See who owes subs | Yes | Counts only | Own bill | No |
| Approve new accounts | Yes | No | No | No |

**Under-18 rules** — "Minimum age for an own account" with value selector `13 ▾` ("Under this age,
everything goes through a guardian's login"); "Guardian sees their child's messages" toggle **on**
("Applies to team groups and any staff message"); "Two adults on every group with juniors" toggle
**on** ("Blocks a one-to-one adult-to-child thread being created at all"); "Hide photos of players
without consent" toggle **on** ("Currently affects 2 players in U12 Reds and 9 across the club").

**Who holds admin** (right): Adam Rowley "Secretary · you" (no remove), Rachel Doyle "Chair"
(*Remove*), Gary Timms "Treasurer · money only" (*Remove*); link **Grant admin to someone**.
**Club record**: Season 2026/27; Subs due 1 September; Match fee £2 per game; FA accreditation
`Current` green; Safeguarding lead Rachel Doyle; FA accredited badge image.
**Connected**: FA Full-Time `Synced 14 min ago`; Card payments `Live`; Bar till `Needs re-auth`
amber.
**Careful** (orange card): "End of season archives every squad, closes all boards and clears
availability. Contacts and payment history are kept." Button *Roll over the season*.

*Data mapping* — `site_settings` (safeguarding keys already guarded by
`site_settings_safeguarding_guard`/`_audit`; minimum age via `safeguarding_setting_int`),
`person_roles` + `has_role()` / `is_club_admin()` / `is_safeguarding_lead()`, `my_capabilities()`,
`audit_log`, `guardian_consents` for the consent counts, `seasons` for roll-over.
**No backing:** the capability matrix as *data* (today it is code — decide whether to render it from
`my_capabilities()` or keep it a static explainer); sub-role labels ("Treasurer · money only");
bar-till integration health; the season roll-over routine.

---

## 3. The board / posts model

One feature, two surfaces. A migration for it has landed in the working tree
(`supabase/migrations/20260824400000_board.sql`, untracked at the time of writing) with tables
`board_posts`, `board_post_teams`, `board_replies`, `board_reads`, type `board_audience`, and
functions `create_board_post()`, `club_lobby_posts()`, `team_board_posts()`, `board_post_thread()`,
`reply_board_post()`, `mark_board_posts_read()`, `set_board_post_pinned()`, `delete_board_post()`,
`can_read_board_post()`, `board_post_audience_count()`. Verify it against this section before
building the UI; anything below that the migration does not cover is still to do.

### 3.1 Club noticeboard (Club lobby)
- Everyone in the club **reads**; admins and coaches **post** (the rule is printed on the card).
- A post has: author (person) + **the author's club role shown beside the name**, date, headline,
  body, optional **pinned** flag (pinned first, `PINNED` eyebrow, tinted background), **read count**
  and **reply count**.
- Read counts are absolute on the lobby ("487 read") and a fraction of the audience on a team board
  ("41 of 46 read").
- Replies are counted on the lobby card; the thread opens from the post / "All posts".

### 3.2 Team bulletin board (team → Communications)
- Same post shape; header rule "Visible to squad, parents and staff".
- The denominator is the team's **contact** count (46 for a 16-player squad — it counts
  guardians/parents, not just players).
- A post pushed from the lobby shows a grey **Club-wide** chip beside the author line, and on the
  team surface a read count with no reply count.
- The pinned post carries an inline **Unpin** action.
- Entry points: *Post to the lobby* (lobby), *Post to board* (team), *Post a notice* (overview).

### 3.3 Owner's requirements — incorporate verbatim
> a club lobby post can be PUSHED to each team's bulletin board but replies land on the main club
> lobby post (one thread)

> a post can be targeted to only certain age groups and teams

Build implications:
- A post needs an `audience` (club | teams), a push flag, and a **single thread** so that a pushed
  post's replies always attach to the originating lobby post — never a per-board copy.
- Targeting joins to age groups **and** teams (`waiting_list_age_groups` already models age groups;
  teams via `teams`). Age groups should be expanded to team rows at posting time so the audience of
  a post is fixed when it is made. Visibility must be expressed in RLS, not the client: a person
  sees a targeted post if their `team_memberships` — or their guardianship of a member — intersects
  the target set.
- Read receipts need a per-person read row, and "41 of 46" needs the resolved audience computed at
  read time (players + staff, with guardians standing in for minors).
- Who may post: admins and coaches (team scope: own team only) per the Settings matrix; parents and
  players 13+ are **reply only**. Anyone who may read may reply.

---

## 4. Gaps & phase suggestions

Ranked by how much of the design is dead without it.

1. **Volunteer / matchday jobs** — "Lend a hand" (lobby), "Matchday jobs" (team), "4 volunteers
   needed" (lobby/overview), "4 of 12 volunteers" (social). One model: a job with a title, a parent
   object (event | fixture | booking | club), a needed count and claimants. Nothing exists.
2. **Read receipts for messages** — the **Announcement** message kind and "Read by 41" in Messages.
   The board has its own reads table; `messages` does not. Same primitive, second consumer.
3. **Attendance rollups** — raw marks exist in `booking_attendance`; every percentage in the design
   (team 87%, per-player 92%, the club per-team bars) is an aggregate with no view or RPC. Cheap
   relative to how visible it is.
4. **Overview / dashboard aggregates** — registered players, teams active, collected vs billed,
   arrears buckets, collection-by-team, other income. All derivable, none exposed; decide one
   `club_overview()` RPC vs many.
5. **Player positions** — "midfield", "keeper", "defence", "forward" on squad cards and "Ben Casey ·
   GK" in the selection chips. `team_memberships` has `shirt_number` and `notes` only: one nullable
   column plus a per-sport vocabulary.
6. **"On this week" lobby feed** — a merged everyone-visible stream over `events` + `bookings` +
   `fixtures` + room hire with colour-coded kinds. Derivable, but needs a public-safe view since
   players and parents see it.
7. **Chase / reminder trail** — "Last chased 19 Aug", "Chased 19 Aug", "reminders last sent 12 Aug",
   "Chase the 1 no-reply", "Chase both". Needs a recorded chase event per member per obligation.
8. **"New to the club"** — recently joined from `people` + `team_memberships.joined_at`; trivial,
   but it names members (including a child) to every signed-in view, so it needs a privacy decision.
9. **Board polish still outstanding** — check the landed migration for: the author's **club role**
   on the byline, the **Unpin** affordance, the club-vs-team read-count presentation, and whether
   reply counts are exposed per surface.
10. **Smaller unbacked bits** — referee name/appointment on `fixtures`; event capacity and ticket
    money on `events`; hardship/paused subs state; bar-till income; a "Needs staff" team flag;
    admin sub-role labels; the season roll-over routine.

### Suggested phase order
- **Phase A — read-only aggregates.** Attendance rollups (3), overview aggregates (4), lobby feed
  (6), new-to-the-club (8). No new writes, no safeguarding surface; unblocks Overview, Training, the
  team glance card and most of the lobby right column.
- **Phase B — finish the board.** Land and review `20260824400000_board.sql`, then item 9 and the
  posting UI. Touches member data and messaging — human-review PR, no auto-merge.
- **Phase C — volunteer jobs (1)** and the **chase trail (7)**. New write paths, but small and
  self-contained; jobs unblock four cards across three screens.
- **Phase D — field-level additions.** Message read receipts (2), positions (5) and the item-10
  list, one migration per area alongside the screen that needs it.
- Stub routes stay on their existing pages throughout; redesign them only after the built screens
  land.

---

## Addendum — owner rulings after the design landed (2026-08-25)

These override the transcribed design where they conflict:

1. **First sign-in lands on the Club Lobby**, not a role-picker. The `/welcome` tiles remain as "My role" for deliberate visits; the middleware's first-visit nudge is gone.
2. **A team-scoped Parent or Player pick in the switcher goes to that team's page** (`/teams/<id>`), not to a list. The team page admits parents/players of the team with a reduced tab set (see #101 follow-up).
3. **The parent view has no Pitches section** ("Parents don't need to see pitch calendars"). §1's "Pitch calendar: all views" row is overridden — player/coach/admin only.
4. **Admin lands on Overview**; coach on Teams; function room on Room bookings; everyone else the Lobby.
5. **Meet times**: events carry `meet_minutes_before` (relative, reschedule-proof); match types default to 30 minutes before kick-off.
6. **Seasons run 1 July – 30 June** (age-group derivation anchors at 1 July; the FA birth-cohort cutoff stays 31 August).
7. **The parent menu, second pass** (2026-08-25, supersedes the morning's "Club Lobby, Team, My Groups, Messages" shape): first login lands on the Club Lobby as the main page, and the parent view's menu is exactly — **Club**: Club Lobby, My groups, Messaging, Events, Registrations · **Me**: My Profile, Connected Adults, My Children · **Finance**: My Subs · **Safeguarding**: Report a concern · **Settings**: Comms preferences. Events returns to the parent view; the Team entry goes (a team-scoped switcher pick still lands on the team page; the menu reaches teams through My Children). "Registrations" is the household status list (`my_registrations()`, no form/medical), not the admin queue; "Connected Adults" is `my_household()` — the join wizard's household adults, read back at last (migration `20260824470000`). Second ruling, same day: **the connection is the family membership, not the absence of a login** — "a connected adult may come under a family membership … at lead contact level. They will have their own login but membership paid by another adult." `my_household()` redefined (`20260824490000`): login-less adults the caller created, adults on a membership the caller leads (own login or not), and the lead contact whose membership covers the caller.

Additional confirmed gap for a later wave: **/join never matches existing people** (name+DOB), so a re-registration creates duplicates — needs a dedupe/match step at the desk.
