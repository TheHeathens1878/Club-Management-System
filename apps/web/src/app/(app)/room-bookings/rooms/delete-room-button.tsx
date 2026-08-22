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
      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors disabled:opacity-50"
      title="Delete room"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      Delete room
    </button>
  );
}
