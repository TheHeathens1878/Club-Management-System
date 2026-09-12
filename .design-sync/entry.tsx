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
