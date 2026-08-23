import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SupabaseAuthStorage } from "@club/shared";
import * as SecureStore from "expo-secure-store";

import {
  chunkKey,
  decodeManifest,
  encodeManifest,
  needsChunking,
  sanitiseKey,
  splitIntoChunks,
} from "./secure-chunks";

/**
 * Session storage for gotrue.
 *
 * Primary store is expo-secure-store (iOS Keychain / Android
 * EncryptedSharedPreferences) so refresh tokens are encrypted at rest and are
 * not readable from a filesystem backup. Values above the ~2048-byte SecureStore
 * limit are chunked (see ./secure-chunks).
 *
 * AsyncStorage is the fallback for any environment where SecureStore is
 * unavailable or throws (Expo Go on some hosts, a device with no keystore,
 * a keychain error after a restore). The fallback is sticky for the process so
 * we do not thrash between the two, and reads always check AsyncStorage when
 * SecureStore has nothing — that also migrates sessions written by an earlier
 * AsyncStorage-only build of the app.
 */

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  // The session must be readable while the app refreshes tokens in the
  // background, i.e. after the first unlock rather than only while unlocked.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

let forcedFallback = false;
let availability: Promise<boolean> | null = null;

async function secureStoreUsable(): Promise<boolean> {
  if (forcedFallback) return false;
  availability ??= SecureStore.isAvailableAsync().catch(() => false);
  const available = await availability;
  return available && !forcedFallback;
}

function fallBack(operation: string, error: unknown): void {
  forcedFallback = true;
  console.warn(
    `[auth-storage] SecureStore ${operation} failed; falling back to AsyncStorage`,
    error,
  );
}

async function readChunkCount(key: string): Promise<number | null> {
  const head = await SecureStore.getItemAsync(
    sanitiseKey(key),
    SECURE_STORE_OPTIONS,
  );
  return decodeManifest(head);
}

async function deleteChunks(key: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, index), SECURE_STORE_OPTIONS);
  }
}

async function secureRemove(key: string): Promise<void> {
  const existing = await readChunkCount(key);
  if (existing !== null) await deleteChunks(key, existing);
  await SecureStore.deleteItemAsync(sanitiseKey(key), SECURE_STORE_OPTIONS);
}

export const authStorage: SupabaseAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (await secureStoreUsable()) {
      try {
        const head = await SecureStore.getItemAsync(
          sanitiseKey(key),
          SECURE_STORE_OPTIONS,
        );
        if (head !== null) {
          const count = decodeManifest(head);
          if (count === null) return head;

          const parts: string[] = [];
          for (let index = 0; index < count; index += 1) {
            const part = await SecureStore.getItemAsync(
              chunkKey(key, index),
              SECURE_STORE_OPTIONS,
            );
            // A torn write (app killed mid-save) leaves a gap. Treat the whole
            // session as absent and clear it, rather than handing gotrue a
            // truncated JSON blob it would throw on.
            if (part === null) {
              await secureRemove(key);
              return null;
            }
            parts.push(part);
          }
          return parts.join("");
        }
      } catch (error) {
        fallBack("getItem", error);
      }
    }
    return AsyncStorage.getItem(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    if (await secureStoreUsable()) {
      try {
        const previous = await readChunkCount(key);
        if (previous !== null) await deleteChunks(key, previous);

        if (needsChunking(value)) {
          const chunks = splitIntoChunks(value);
          for (const [index, chunk] of chunks.entries()) {
            await SecureStore.setItemAsync(
              chunkKey(key, index),
              chunk,
              SECURE_STORE_OPTIONS,
            );
          }
          await SecureStore.setItemAsync(
            sanitiseKey(key),
            encodeManifest(chunks.length),
            SECURE_STORE_OPTIONS,
          );
        } else {
          await SecureStore.setItemAsync(
            sanitiseKey(key),
            value,
            SECURE_STORE_OPTIONS,
          );
        }

        // Drop any copy left by an earlier AsyncStorage-only build so the
        // session lives in exactly one place.
        await AsyncStorage.removeItem(key).catch(() => undefined);
        return;
      } catch (error) {
        fallBack("setItem", error);
      }
    }
    await AsyncStorage.setItem(key, value);
  },

  async removeItem(key: string): Promise<void> {
    if (await secureStoreUsable()) {
      try {
        await secureRemove(key);
      } catch (error) {
        fallBack("removeItem", error);
      }
    }
    await AsyncStorage.removeItem(key);
  },
};
