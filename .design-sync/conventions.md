## Building with the Club Management System components

**Setup.** No provider is needed. `styles.css` (import its closure) defines the crest theme as HSL
tokens on `:root`, a `.dark` scheme, and a `.theme-ink` scope (the dark sidebar rail: put that class
on the rail container and every component inside adapts). It also declares `--font-sans` (Source
Sans 3, body) and `--font-display` (Oswald, headings) and loads both from Google Fonts. `body`
already gets `bg-background text-foreground`; add `font-sans antialiased` to the page root.

**Styling idiom: Tailwind utilities with semantic colour tokens.** Never hard-code hex; use the
token classes, which follow light, dark and ink scopes automatically:

| Family | Classes that exist in `styles.css` |
|---|---|
| Surfaces | `bg-background` (paper), `bg-card` (white card), `bg-secondary` (tint), `bg-primary` (crest orange), `bg-accent` (bright crest, count pills), `bg-destructive` |
| Text | `text-foreground`, `text-muted-foreground`, `text-primary`, `text-primary-foreground`, `text-accent-foreground`, `text-destructive` |
| Borders | `border` (already `border-border`), `border-input`, `divide-y` |
| Status | `success` · `warning` · `info` · `destructive`, each with a `-tint` wash and a `-foreground`: `bg-success-tint text-success` is the chip, `text-warning` the ink, `bg-info text-info-foreground` the rare solid fill. **Never** `emerald-*`, `amber-*`, `green-*`, `red-*`, `sky-*` or any other literal — they are fixed sRGB and ignore the dark and ink scopes |
| Radius | A ladder, outside → in: `rounded-full` pills and avatars · `rounded-xl` surfaces (cards, sheets, panels) · `rounded-lg` insets (something sitting inside a card) · `rounded-md` controls (buttons, inputs). `rounded-t-2xl` only for the grabber edge of a bottom sheet. Never `rounded-[9px]` |
| Shadow | Three elevations and no more: `shadow-sm` resting (a card on paper) · `shadow-lg` floating (a popover, a menu anchored to its trigger) · `shadow-2xl` owns the screen (a sheet over a scrim). Never `shadow-[…]` |
| Type | `font-display uppercase tracking-wide` for page and section titles (Oswald caps). The body scale is named, never pixels: `text-2xs` (10px, a micro-label over a tile) · `text-xs` (12px, detail lines, usually `text-muted-foreground`) · `text-list` (13px, a dense row of data) · `text-sm` (14px, body) · `text-row` (15px, a card's own line) · `text-panel` (17px, a sheet heading or a stat figure) · `text-lg`/`text-xl` above. **Never `text-[Npx]`** — pick the nearest name and let it shift half a pixel |
| Layout | `space-y-1.5` (label + control), `space-y-5` (sections), `gap-2`/`gap-3` flex rows, `px-4 py-4 lg:px-8` page padding |

Only utilities present in `styles.css` exist (it is compiled from the app): check before using an
unusual class, and fall back to an inline `style` for anything missing. Phone hit targets are the
`.touch` class, not `min-h-[44px]` — it carries the 44px floor and releases it at `lg`, which is the
line between phone and desk everywhere in this app. On a `Button`, `size="touch"` does the same.

**Every `icon` prop takes a RENDERED element, never a component.** `icon={<Users className="h-4 w-4"
aria-hidden />}`, not `icon={Users}`. That holds for `IconTile`, `FoldCard`, `Callout`, `StatTile`,
`ActionBar`, `EmptyState`, `HubList`, `Sheet`'s `headerAction` and `DataListFrame`'s `empty.icon`.
The caller sizes the glyph (`h-4 w-4` in a row, `h-5 w-5` over an empty state); the component sizes
whatever sits round it.

**Screen anatomy: one page = one object.** The title is the object; everything else is its parts.

1. `PageHeader` names the object (Oswald caps, `back` naming the parent list, one optional `action`).
2. An `ActionBar` says what the object needs and carries the ONE button that does it — `status` is
   the sentence, `detail` the line under it, `tone` what it means (`waiting` = nothing moves until
   you press, `done` = the past tense, `error` = what went wrong). Disable the button with the
   reason on it rather than hiding the bar.
3. One glanceable body: a `StatRow` of `StatTile`s (two across on a phone, four at `lg`), a grid, or
   a `DataListFrame` — the dense list that draws itself as a table at `lg` and as cards on a phone
   from one filtered set of rows. `Table` + `THead`/`TH`/`TBody`/`TR`/`TD` are the bare class
   strings for a small table with no behaviour; `LinkRow` makes a whole row the link. An empty list
   is an `EmptyState`, never a bare "No … yet" paragraph.
4. Pressing a card opens a `Sheet` — bottom sheet on a phone, right-hand drawer at `lg` — whose
   view / edit / clone / remove are `mode`s, not routes. A menu anchored to its trigger is a
   `Popover`. Never a bespoke `fixed inset-0`.
5. Settings fold beneath in `FoldCard`s whose closed `summary` is real text ("Christmas, Half-term"),
   so the row is worth reading folded.

Filters are URLs: `ToggleChipLink` in a `ChipStrip`, or a `FilterRail` at `lg`. `ToggleChip` (the
button) is only for a toggle that changes nothing but what is drawn. `Callout` is the tinted box for
something the reader must notice; `Eyebrow` the small caps label over a group; `Skeleton` the grey
bars in the shape of what is arriving; `Kbd` a keyboard shortcut drawn as a key.

Hub screens are a `HubList` of grouped rows. Forms are `Label` + `Input` / `Select` / `Textarea`
stacks in `space-y-1.5`, with one `SubmitButton` inside the `<form>`; inside a `Sheet` the controls
need `className="touch"`, because `Input` and `Select` are 40px. People are `Avatar` (initials
fallback); players on a pitch are `PlayerToken`. Navigation is a `.theme-ink` top bar of `NavLink`s
at every width; phones add `MobileTabBar`.

**Where the truth lives.** `styles.css` (tokens, scopes, fonts), then each
`components/general/<Name>/<Name>.prompt.md` for props and working examples.

```jsx
<div className="min-h-screen bg-background font-sans antialiased">
  <PageHeader
    title="U11 Venus"
    subtitle="Sunday league · 14 registered players"
    back={{ href: "/my-teams", label: "Teams" }}
    action={<Button size="sm">Add player</Button>}
  />
  <div className="space-y-5 px-4 py-4 lg:px-8">
    <ActionBar
      icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />}
      tone="waiting"
      status="4 players have not replied about Sunday"
      detail="Kick-off 10:30 at Carrington, Pitch 2."
      action={<Button size="touch">Remind them</Button>}
    />
    <StatRow>
      <StatTile label="Registered" value="14" />
      <StatTile label="Available" value="10" tone="success" hint="for Sunday" />
      <StatTile label="Awaiting DOB" value="2" tone="warning" href="/people?missing=dob" />
      <StatTile label="Subs owed" value="£90" tone="danger" href="/finance/charges" />
    </StatRow>
    <Card>
      <CardHeader>
        <CardTitle>Next fixture</CardTitle>
        <CardDescription>v Sale United · Sunday 10:30, Carrington</CardDescription>
      </CardHeader>
      <CardContent>
        <Badge variant="success">Pitch 2 confirmed</Badge>
      </CardContent>
    </Card>
    <FoldCard
      icon={<Settings className="h-4 w-4" aria-hidden />}
      title="Team settings"
      summary="Sunday league · Tuesdays 18:00 · Full-Time linked"
    >
      <EmptyState
        icon={<Inbox className="h-5 w-5" aria-hidden />}
        title="No messages yet"
        action={{ href: "/messages/new", label: "Start one" }}
      />
    </FoldCard>
  </div>
</div>
```
