import * as ImagePicker from "expo-image-picker";

import { attachmentFileName, attachmentPath, base64ToBytes } from "./base64";
import { getSupabase } from "./supabase";

/**
 * Message attachments.
 *
 * Upload path: pick an image → upload the bytes to the private `attachments`
 * bucket with the *user* client → insert the `message_attachments` row. The
 * storage policy `attachments_participant_upload` (P5.2) allows the INSERT for
 * any signed-in person with a `people` record; the table policy
 * `attachments_sender_insert` then narrows the row to the sender of the
 * message it hangs off.
 *
 * Read path: `storage.from("attachments").createSignedUrl(...)`, short-lived.
 *
 * KNOWN GAP. P5.2 creates the bucket private and writes only an INSERT policy
 * on `storage.objects` for it — there is no SELECT policy — so signing a URL
 * as the user client is expected to fail with "Object not found" / 400 until a
 * participant-scoped SELECT policy (or an Edge Function minting the URL, the
 * shape `media-signed-url` already uses for P4.5) is added. `signedUrlFor`
 * therefore returns null rather than throwing, and the thread renders a
 * placeholder that says the image cannot be shown yet.
 */

export const ATTACHMENTS_BUCKET = "attachments";

/** Signed URLs are short-lived; long enough to render, not to share. */
const SIGNED_URL_SECONDS = 300;

export interface PickedImage {
  base64: string;
  contentType: string;
  fileName: string;
  byteSize: number;
}

export type PickResult =
  | { ok: true; image: PickedImage }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: string };

/** 20 MB, comfortably inside the bucket's 25 MB limit after base64 overhead. */
const MAX_BYTES = 20 * 1024 * 1024;

export async function pickImage(): Promise<PickResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      ok: false,
      cancelled: false,
      error:
        "Photo access is off for this app. Turn it on in Settings to send a picture.",
    };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: 0.8,
    // base64 avoids a second native module just to read the file off disk.
    base64: true,
  });

  if (result.canceled) return { ok: false, cancelled: true };

  const asset = result.assets[0];
  if (!asset?.base64) {
    return {
      ok: false,
      cancelled: false,
      error: "That image could not be read. Try a different one.",
    };
  }

  const contentType = asset.mimeType ?? "image/jpeg";
  const byteSize = asset.fileSize ?? Math.floor((asset.base64.length * 3) / 4);
  if (byteSize > MAX_BYTES) {
    return {
      ok: false,
      cancelled: false,
      error: "That image is too large to send (over 20 MB).",
    };
  }

  return {
    ok: true,
    image: {
      base64: asset.base64,
      contentType,
      fileName: attachmentFileName(asset.uri, contentType),
      byteSize,
    },
  };
}

/**
 * Uploads the picked image and records it against a message that has already
 * been inserted (the table policy keys off the message's sender).
 */
export async function uploadAttachment(
  conversationId: string,
  messageId: string,
  image: PickedImage,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const supabase = getSupabase();
  const path = attachmentPath(conversationId, messageId, image.fileName);

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(image.base64);
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : "Unreadable image.",
    };
  }

  const { error: uploadError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, bytes, {
      contentType: image.contentType,
      upsert: false,
    });
  if (uploadError) {
    return { ok: false, error: `Upload failed: ${uploadError.message}` };
  }

  const { error: rowError } = await supabase
    .from("message_attachments")
    .insert({
      message_id: messageId,
      storage_bucket: ATTACHMENTS_BUCKET,
      storage_path: path,
      content_type: image.contentType,
      byte_size: image.byteSize,
    });
  if (rowError) {
    return {
      ok: false,
      error: `The image uploaded but could not be attached: ${rowError.message}`,
    };
  }

  return { ok: true, path };
}

/**
 * A short-lived signed URL, or null when the user client is not allowed to
 * read the object (see the KNOWN GAP above). Never throws: an attachment that
 * cannot be signed becomes a placeholder, not a broken screen.
 */
export async function signedUrlFor(path: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabase()
      .storage.from(ATTACHMENTS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_SECONDS);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
