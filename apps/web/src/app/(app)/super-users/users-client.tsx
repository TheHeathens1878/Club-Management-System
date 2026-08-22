"use client";

import { useState, useTransition } from "react";
import { updateUserRole, inviteUser, removeUser, resendInvite, updateUserName } from "./actions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { UserCircle, Trash2, Send, RefreshCw, Pencil, Check, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const ROLE_LABELS: Record<string, string> = {
  super_user: "Super User",
  committee: "Committee",
  bar_manager: "Bar Manager",
  bar: "Bar Staff",
  member: "Member",
};

type User = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  last_sign_in: string | null;
};

export function UsersClient({
  users,
  currentUserId,
}: {
  users: User[];
  currentUserId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"committee" | "bar_manager" | "bar" | "super_user">("committee");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [resendStatus, setResendStatus] = useState<Record<string, "sending" | "sent" | "error">>({});
  const [editingName, setEditingName] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const staffUsers = users.filter((u) => u.role !== "member");
  const memberUsers = users.filter((u) => u.role === "member");

  function handleRoleChange(userId: string, role: string) {
    startTransition(() => {
      updateUserRole(userId, role as "super_user" | "committee" | "bar_manager" | "bar" | "member");
    });
  }

  function handleRemove(userId: string, email: string) {
    if (!confirm(`Remove ${email}? This will delete their account permanently.`)) return;
    startTransition(() => { removeUser(userId); });
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(false);
    startTransition(async () => {
      try {
        await inviteUser(inviteEmail, inviteRole, inviteName);
        setInviteEmail("");
        setInviteName("");
        setInviteSuccess(true);
      } catch (err) {
        setInviteError(err instanceof Error ? err.message : "Failed to invite user.");
      }
    });
  }

  function startEditName(user: User) {
    setEditingName(user.id);
    setNameDraft(user.full_name ?? "");
  }

  function saveName(userId: string) {
    const name = nameDraft;
    setEditingName(null);
    startTransition(async () => {
      try {
        await updateUserName(userId, name);
      } catch { /* ignore */ }
    });
  }

  async function handleResend(userId: string) {
    setResendStatus((s) => ({ ...s, [userId]: "sending" }));
    try {
      await resendInvite(userId);
      setResendStatus((s) => ({ ...s, [userId]: "sent" }));
    } catch {
      setResendStatus((s) => ({ ...s, [userId]: "error" }));
    }
  }

  function UserRow({ user }: { user: User }) {
    const neverSignedIn = !user.last_sign_in;
    const status = resendStatus[user.id];
    return (
      <div className="flex items-center gap-3 py-3 border-b last:border-b-0">
        <div className="flex-shrink-0 rounded-full bg-primary/10 p-2 text-primary">
          <UserCircle className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          {editingName === user.id ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Full name"
                className="h-7 text-sm py-1"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") saveName(user.id); if (e.key === "Escape") setEditingName(null); }}
              />
              <button onClick={() => saveName(user.id)} className="text-green-600 hover:text-green-700 p-1" title="Save">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setEditingName(null)} className="text-muted-foreground hover:text-foreground p-1" title="Cancel">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <p className="text-sm font-medium truncate flex items-center gap-1.5">
              {user.full_name ?? <span className="text-muted-foreground italic">No name set</span>}
              <button onClick={() => startEditName(user)} className="text-muted-foreground hover:text-primary p-0.5" title="Edit name">
                <Pencil className="h-3 w-3" />
              </button>
            </p>
          )}
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          {user.last_sign_in ? (
            <p className="text-xs text-muted-foreground">
              Last sign in {formatDistanceToNow(new Date(user.last_sign_in), { addSuffix: true })}
            </p>
          ) : (
            <p className="text-xs text-amber-600">Invite not yet accepted</p>
          )}
        </div>
        {neverSignedIn && user.id !== currentUserId && (
          <button
            onClick={() => handleResend(user.id)}
            disabled={status === "sending"}
            title="Resend invite"
            className="text-muted-foreground hover:text-primary transition-colors p-1 shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${status === "sending" ? "animate-spin" : ""}`} />
          </button>
        )}
        {status === "sent" && <span className="text-xs text-emerald-600 shrink-0">Resent</span>}
        {status === "error" && <span className="text-xs text-destructive shrink-0">Failed</span>}
        <select
          value={user.role}
          onChange={(e) => handleRoleChange(user.id, e.target.value)}
          disabled={isPending || user.id === currentUserId}
          className="rounded-md border bg-background px-2 py-1 text-sm shrink-0"
        >
          <option value="super_user">Super User</option>
          <option value="committee">Committee</option>
          <option value="bar_manager">Bar Manager</option>
          <option value="bar">Bar Staff</option>
          <option value="member">Member</option>
        </select>
        {user.id !== currentUserId && (
          <button
            onClick={() => handleRemove(user.id, user.email)}
            disabled={isPending}
            className="text-muted-foreground hover:text-destructive transition-colors p-1 shrink-0"
            title="Remove user"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Invite form */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-semibold mb-4">Invite a new user</h3>
          <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="invite-name">Name</Label>
              <Input
                id="invite-name"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@example.com"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="committee">Committee</option>
                <option value="bar_manager">Bar Manager</option>
                <option value="bar">Bar Staff</option>
                <option value="super_user">Super User</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="invisible">Send</Label>
              <Button type="submit" disabled={isPending} className="w-full gap-2">
                <Send className="h-4 w-4" /> Invite
              </Button>
            </div>
          </form>
          {inviteSuccess && (
            <p className="mt-3 text-sm text-emerald-600">Invitation sent successfully.</p>
          )}
          {inviteError && (
            <p className="mt-3 text-sm text-destructive">{inviteError}</p>
          )}
        </CardContent>
      </Card>

      {/* Staff list */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-semibold mb-2">Staff & admins ({staffUsers.length})</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Click <RefreshCw className="inline h-3 w-3" /> to resend an invite for anyone who hasn&apos;t signed in yet.
          </p>
          {staffUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No staff users yet.</p>
          ) : (
            staffUsers.map((u) => <UserRow key={u.id} user={u} />)
          )}
        </CardContent>
      </Card>

      {/* Members list */}
      {memberUsers.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold mb-2">Members ({memberUsers.length})</h3>
            {memberUsers.map((u) => <UserRow key={u.id} user={u} />)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
