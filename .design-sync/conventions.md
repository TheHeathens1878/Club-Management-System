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
| Radius | `rounded-md` (10px), `rounded-lg` (12px), `rounded-xl` (cards), `rounded-full` (pills, avatars) |
| Type | `font-display uppercase tracking-wide` for page and section titles (Oswald caps); `text-sm` body; `text-xs text-muted-foreground` for detail lines; `text-[11px] uppercase tracking-[0.16em]` for section eyebrows |
| Layout | `space-y-1.5` (label + control), `space-y-5` (sections), `gap-2`/`gap-3` flex rows, `px-4 py-4 lg:px-8` page padding |

Only utilities present in `styles.css` exist (it is compiled from the app): check before using an
unusual class, and fall back to an inline `style` for anything missing. Phone hit targets are
`min-h-[44px]`; desktop is the `lg:` breakpoint.

**Screen anatomy.** Every screen starts with `PageHeader` (title in Oswald caps, optional `back` and
`action`). Hub screens are a `HubList` of grouped rows; an empty list is an `EmptyState`; tables use
`LinkRow` so the whole row is the link. Forms are `Label` + `Input` / `Select` / `Textarea` stacks in
`space-y-1.5`, with one `SubmitButton` inside the `<form>`. People are `Avatar` (initials fallback);
players on a pitch are `PlayerToken`. Navigation is a `.theme-ink` top bar of `NavLink`s at every width; phones add
`MobileTabBar`.

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
    <Card>
      <CardHeader>
        <CardTitle>Next fixture</CardTitle>
        <CardDescription>v Sale United · Sunday 10:30, Carrington</CardDescription>
      </CardHeader>
      <CardContent>
        <Badge variant="success">Pitch 2 confirmed</Badge>
      </CardContent>
    </Card>
    <EmptyState title="No messages yet" action={{ href: "/messages/new", label: "Start one" }} />
  </div>
</div>
```
