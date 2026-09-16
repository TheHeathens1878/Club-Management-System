// The component surface synced to Claude Design (the "Club Management System"
// design-system project). Everything here is the app's real shipped source;
// data-bound components stay out because they need Supabase or a signed-in
// role to render. Add a line to sync a new component.

// Primitives
export { Button, buttonVariants } from "../apps/web/src/components/ui/button";
export type { ButtonProps } from "../apps/web/src/components/ui/button";
export { Badge, badgeVariants } from "../apps/web/src/components/ui/badge";
export type { BadgeProps } from "../apps/web/src/components/ui/badge";
export { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../apps/web/src/components/ui/card";
export { Input, Label } from "../apps/web/src/components/ui/input";
export type { InputProps } from "../apps/web/src/components/ui/input";
export { Textarea, Select } from "../apps/web/src/components/ui/field";

// Self-contained pieces
export { Avatar } from "../apps/web/src/components/avatar";
export type { AvatarSize } from "../apps/web/src/components/avatar";
export { PlayerToken } from "../apps/web/src/components/player-token";
export { TeamPicker } from "../apps/web/src/components/team-picker";
export type { TeamOption } from "../apps/web/src/components/team-picker";
export { SubmitButton } from "../apps/web/src/components/submit-button";

// Page patterns (next/link and next/navigation are shimmed for the bundle)
export { PageHeader } from "../apps/web/src/components/page-header";
export { EmptyState } from "../apps/web/src/components/empty-state";
export { HubList } from "../apps/web/src/components/hub-list";
export type { HubRow, HubSection } from "../apps/web/src/components/hub-list";
export { LinkRow } from "../apps/web/src/components/link-row";
export { NavLink } from "../apps/web/src/components/nav-link";
export { SectionHomeLink } from "../apps/web/src/components/section-home-link";
export { MobileTabBar } from "../apps/web/src/components/mobile-tab-bar";
export type { MobileTabItem } from "../apps/web/src/components/mobile-tab-bar";

// Shell pieces (P7.5). AppTopBar is not synced: its role switcher calls a
// server action, which cannot bundle for a preview.
export { NounTabs } from "../apps/web/src/components/noun-tabs";
export type { NounTab, NounTabGroup } from "../apps/web/src/components/noun-tabs";
export { FilterRail } from "../apps/web/src/components/filter-rail";
export type { RailGroup, RailOption } from "../apps/web/src/components/filter-rail";

// Overlays (P8.0c). Both own Escape, the press outside and focus; nothing in
// the app should hand-roll a `fixed inset-0` again.
export { Sheet } from "../apps/web/src/components/ui/sheet";
export type { SheetSide } from "../apps/web/src/components/ui/sheet";
export { Popover } from "../apps/web/src/components/ui/popover";

// The small shapes (P8.0d) — the pieces the winter-training block page was
// built from, lifted out of its folder so every screen composes instead of
// copy-pastes. Every `icon` here is a RENDERED element, never a component.
export { IconTile, iconTileVariants } from "../apps/web/src/components/ui/icon-tile";
export type { IconTileProps } from "../apps/web/src/components/ui/icon-tile";
export { FoldCard } from "../apps/web/src/components/ui/fold-card";
export { ToggleChip, ToggleChipLink, toggleChipVariants } from "../apps/web/src/components/ui/toggle-chip";
export type { ToggleChipProps, ToggleChipLinkProps } from "../apps/web/src/components/ui/toggle-chip";
export { ChipStrip } from "../apps/web/src/components/ui/chip-strip";
export { Callout, calloutVariants } from "../apps/web/src/components/ui/callout";
export type { CalloutProps } from "../apps/web/src/components/ui/callout";
export { StatTile, StatRow } from "../apps/web/src/components/ui/stat-tile";
export type { StatTone } from "../apps/web/src/components/ui/stat-tile";
export { ActionBar } from "../apps/web/src/components/ui/action-bar";
export type { ActionBarProps, ActionBarTone } from "../apps/web/src/components/ui/action-bar";
export { Eyebrow } from "../apps/web/src/components/ui/eyebrow";
export { Skeleton } from "../apps/web/src/components/ui/skeleton";
export { Kbd } from "../apps/web/src/components/ui/kbd";

// Lists (P8.0e). `Table` and its five parts are the app's table class strings,
// named; `DataListFrame` is the list that draws itself twice — a dense table at
// `lg`, a stack of cards on a phone — from one filtered set of rows. All six
// table exports are here because that is what every screen imports, but only
// Table, THead and TBody are pinned in config.json: the extractor reads a
// SCREAMING-CASE export as an enum, so TH, TR and TD can never be entries of
// their own and are documented inside Table's props instead.
export { Table, THead, TH, TBody, TR, TD } from "../apps/web/src/components/ui/table";
export { DataListFrame } from "../apps/web/src/components/ui/data-list";
export type { DataColumn, DataItem, DataListFrameProps } from "../apps/web/src/components/ui/data-list";
