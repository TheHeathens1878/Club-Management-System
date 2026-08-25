"use client";

import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { deleteRoom } from "../actions";

export function DeleteRoomButton({ roomId, roomName }: { roomId: string; roomName: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (!confirm(`Delete room "${roomName}"? This cannot be undone.\n\nExisting bookings will not be deleted, but the room will no longer appear in the system.`)) return;
    setLoading(true);
    await deleteRoom(roomId);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50 sm:min-h-0 sm:w-auto"
      title="Delete room"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      Delete room
    </button>
  );
}
