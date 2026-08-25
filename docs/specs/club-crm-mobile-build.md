# Club CRM — Mobile build specification

Source: Claude Design project `0abbccb4-8fac-49de-ba72-a6f1a185443e`, file
`Club CRM - Mobile.dc.html` (decoded copy: `club-crm-mobile.dc.html` beside this file).
Eight 390×844 artboards: Club lobby · Team overview · Availability · Communications
(board) · Team chat · More · Role switcher (sheet) · My subs.

Design's own summary: "Same routes, same role scoping, same crest palette. Three
things change on a phone: the sidebar becomes a five-item tab bar with everything
else behind More; every dense table becomes a stack of cards; and the jobs that
happen pitchside — replying to availability, taking a register, reading the board —
are one tap from opening the app. Hit targets are 44px or more throughout."

Goal (Adam): full mobile-friendly version of the web app, suitable as a web app
and future iOS/Android deployment. So: responsive Next.js (`apps/web`) per this
design + PWA installability. `apps/mobile` (Expo) is NOT this task.

## Part 1 — Shell (one PR, lands first)

1. **Tab bar** (`src/lib/mobile-nav.ts` + `src/components/mobile-tab-bar.tsx`):
   fixed bottom, 5 slots, `lg:hidden`, safe-area inset bottom, active = crest
   orange + 600 weight, unread badge on Messages. Role-scoped (design):
   - admin: Lobby /lobby · Messages /messages · Teams /teams · Diary /events · More
   - coach: same as admin
   - player: Lobby · Messages · My teams /my-teams · Events /events · More
   - parent: Lobby · Messages · Children /family · Events /events · More
   - me: Lobby · Messages · My groups /messages?filter=groups (Children /family if guardian) · Events · More
   - function_room: Room bookings /room-bookings · Pending /room-bookings?status=pending&view=list · Hire contacts /room-bookings/contacts · Bar /bar (if bar manager, else Rooms) · More
   Every slot passes the same `allowed(capabilities)` gate as nav.ts; slots that
   fail collapse (fall back to next-most-relevant allowed item or fewer tabs).
2. **More screen** (`/more` route): dark header with "More" + Viewing-as tile
   (opens switcher sheet); body = the rest of `navFor(view, caps)` minus tab-bar
   items, grouped in white cards with icon rows + chevrons; "Report a concern"
   as an accent-bordered card ("Open to everyone, in every role"); Notifications
   row with unread badge; Sign out. On lg+ redirect to view home (it has a sidebar).
3. **Role switcher bottom sheet**: mobile variant of `RoleSwitcher` — overlay +
   bottom sheet (grab handle, "Viewing as" title + explainer "Each role shows its
   own menu…", icon tiles per role kind, tick on active, Cancel). Same
   `switchRoleView` action. Sidebar (lg+) keeps the existing dropdown.
4. **Mobile app header**: `lg:hidden` dark (`theme-ink`) top bar — crest 34px,
   "AoM Sports Club" Oswald caps, current role in accent underneath (tapping
   opens the switcher sheet), avatar initials right. Sub-pages keep their own
   PageHeader; this bar is the shell identity strip.
5. **Layout**: `(app)/layout.tsx` — sidebar becomes `hidden lg:flex` (today it
   degrades into a broken top strip); mobile gets header + `<main>` +
   tab bar; main gets `pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0`.
6. **PWA**: `src/app/manifest.ts` (name "AoM Sports Club", short_name "AoM Club",
   display standalone, start_url /lobby, theme_color #14100E, background_color
   #F7F4F0, icons 192/512 from crest — generate maskable-safe PNGs into public/),
   apple-touch-icon + `viewport` export (`viewportFit: "cover"`, themeColor),
   safe-area utilities. No service worker this pass (no offline claim) — note it.
7. **Global idioms**: min 44px hit targets on mobile controls; a documented
   table→card pattern (cards `lg:hidden` + table `hidden lg:block`, or
   `overflow-x-auto` for long-tail admin desks).

## Part 2 — Screens (parallel batches after shell)

Faithful to drawn artboards; everything else gets the idiom (card stacks, no
horizontal page scroll, 44px targets). Batches:

- **A Lobby/social/events**: /lobby (+[id],new — pinned card, On this week rows
  with colour bars, Lend a hand), /social, /events (+[id],new), /notifications.
- **B Teams**: /teams (table→cards), /teams/[id] (dark team header + horizontal
  tab strip Overview/Comms/Squad/Training/Subs, format strip, next-match card,
  availability bar, register), /teams/[id]/fixtures/[fixtureId] (availability
  screen artboard: Yes/No/Maybe 44px row, squad list, Nudge), /my-teams, /my-team.
- **C Matchday/pitches**: /matches, /training, /pitches{,/calendar,/book,/mine,
  /requests,/clashes,/manage,/[bookingId]{,/edit}}. Calendars/grids may scroll
  horizontally inside their own container.
- **D Messages** (own PR — §2.3 no-auto-merge, flag for Adam): /messages
  (list rows per artboard), /messages/[id] (chat artboard: announcement styling,
  sticky composer above tab bar/keyboard, safeguarding footer), /messages/new,
  /groups suite.
- **E People/admin**: /people (+[id],new — card rows per §2.7 of desktop spec),
  /approvals, /registrations, /my-registrations, /waiting-list/manage{,access},
  /family, /profile, /connected-adults, /welcome, /complete-profile.
- **F Money**: /subs, /my-subs (artboard: due card with big £, Pay button,
  children rows, paid-this-season list), /overview (counter tiles 2-up).
- **G Room/ops** : /room-bookings suite, /bar, /settings{,comms}, /safeguarding
  suite (own PR or bundled with D for human review), /media, /email-templates,
  /super-users.

## Process
- Branch from main AFTER the parallel session's wave6 work merges. Worktree per
  batch if run in parallel (shared-checkout memory).
- Sub-agents: model opus (CLAUDE.md).
- No schema changes anticipated. If a screen needs data that doesn't exist,
  build the layout with what exists — no new migrations in this wave.
- Verify per PR: `pnpm turbo run lint typecheck` (concurrency 1 if V8 aborts),
  `pnpm --filter @club/web build`.
- PRs D (+ safeguarding screens) → human review (PLAN §2.3). Rest auto-merge
  per Adam's standing "apply without input".
