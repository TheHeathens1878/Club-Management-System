"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Loader2, Upload } from "lucide-react";

import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

import { confirmSubjects, registerMediaItem, type ActionState } from "../actions";

const EMPTY: ActionState = {};

export type TagCandidate = { id: string; name: string };

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80);
}

/**
 * Upload straight from the browser to the private `media` bucket using the
 * user's own client — the storage policy (club admins and child-facing staff)
 * is what admits the file — then register the row through a server action so
 * `media_items`' own insert policy gets its say too.
 */
export function UploadPanel({ albumId }: { albumId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error?: string; notice?: string }>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage({ error: "Choose a file first." });
      return;
    }
    setMessage({});

    const supabase = createClient();
    const path = `${albumId}/${Date.now()}-${safeName(file.name)}`;
    const { error } = await supabase.storage.from("media").upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (error) {
      setMessage({ error: error.message });
      return;
    }

    const formData = new FormData();
    formData.set("album_id", albumId);
    formData.set("storage_path", path);
    formData.set("content_type", file.type);
    formData.set("byte_size", String(file.size));
    formData.set("caption", captionRef.current?.value ?? "");

    const result = await registerMediaItem({}, formData);
    setMessage(result);
    if (!result.error && fileRef.current) {
      fileRef.current.value = "";
      if (captionRef.current) captionRef.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="media-file">Photo or video</Label>
          <Input
            id="media-file"
            ref={fileRef}
            type="file"
            accept="image/*,video/mp4"
            className="h-11 lg:h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="media-caption">Caption</Label>
          <Input id="media-caption" ref={captionRef} placeholder="Optional" className="h-11 lg:h-10" />
        </div>
      </div>

      {message.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {message.error}
        </p>
      )}
      {message.notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message.notice}
        </p>
      )}

      <button
        type="button"
        onClick={() => startTransition(upload)}
        disabled={pending}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 sm:min-h-0 sm:w-auto sm:justify-start"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Upload
      </button>
      <p className="text-xs text-muted-foreground">
        An upload is hidden from the gallery until someone confirms who is in it.
      </p>
    </div>
  );
}

/** "Confirm who is in this photo" — the step SG-5 turns on. */
export function TagForm({
  albumId,
  itemId,
  candidates,
  selected,
}: {
  albumId: string;
  itemId: string;
  candidates: TagCandidate[];
  selected: string[];
}) {
  const [state, action, pending] = useActionState(confirmSubjects, EMPTY);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="album_id" value={albumId} />
      <input type="hidden" name="item_id" value={itemId} />
      <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2 sm:max-h-40">
        {candidates.length === 0 && (
          <p className="p-1 text-xs text-muted-foreground">
            No team members to choose from. Confirming with nobody selected records that there is
            no identifiable person in the photo.
          </p>
        )}
        {candidates.map((person) => (
          <label
            key={person.id}
            className="flex min-h-[36px] items-center gap-2 text-xs sm:min-h-0"
          >
            <input
              type="checkbox"
              name="person_id"
              value={person.id}
              defaultChecked={selected.includes(person.id)}
              className="h-3.5 w-3.5 shrink-0"
            />
            {person.name}
          </label>
        ))}
      </div>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      {state.notice && <p className="text-xs text-emerald-700">{state.notice}</p>}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md border px-2 py-1 text-xs font-medium hover:bg-secondary disabled:opacity-60 sm:min-h-0 sm:w-auto"
      >
        Confirm subjects
      </button>
    </form>
  );
}
