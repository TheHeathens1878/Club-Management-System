// Web Push, encrypted the way the specification requires.
//
// A browser's push subscription cannot simply be POSTed to. RFC 8291 says the
// payload is encrypted END TO END with a key only that browser holds, and RFC
// 8292 (VAPID) says the request is signed so the push service knows which
// application server is asking. Neither is optional and no push service will
// accept a request missing either — which is why this file exists rather than
// a one-line `fetch`.
//
// It is written against WebCrypto, which the edge runtime has, so there is no
// dependency to pin and nothing to audit but this.
//
//   1. VAPID (RFC 8292). A JWT — ES256, `aud` = the push service's origin,
//      `sub` = a mailto: the service can complain to, `exp` under 24 h — sent
//      as `Authorization: vapid t=<jwt>, k=<our public key>`.
//
//   2. Payload encryption (RFC 8291, aes128gcm). A fresh ECDH keypair per
//      message; the shared secret is combined with the browser's `auth` secret
//      through HKDF to give a content-encryption key and a nonce; the body is
//      the aes128gcm header (salt, record size, our public key) followed by
//      one AES-GCM record. The plaintext is padded with a single 0x02
//      delimiter byte, which is what marks the last record.
//
// WHAT A CALLER GETS BACK. 201 is delivered. 404 and 410 mean the subscription
// is gone and the caller should forget the endpoint — the same contract Expo's
// `DeviceNotRegistered` has, so `comms-dispatch` can prune both the same way.

const encoder = new TextEncoder();

export type WebSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type WebPushOutcome =
  | { ok: true }
  /** The push service says this subscription no longer exists. Forget it. */
  | { ok: false; gone: true; error: string }
  | { ok: false; gone: false; error: string };

// --- base64url ---------------------------------------------------------------

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// --- VAPID (RFC 8292) --------------------------------------------------------

/**
 * The private key arrives as the raw 32-byte scalar in base64url — which is
 * what `web-push generate-vapid-keys` prints and what every other library
 * expects. WebCrypto will not import that directly, so it is presented as a
 * JWK alongside the public point it belongs to.
 */
async function importVapidKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const pub = b64urlToBytes(publicKey); // 65 bytes: 0x04 || X || Y
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("VAPID public key is not an uncompressed P-256 point");
  }
  return await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToB64url(pub.slice(1, 33)),
      y: bytesToB64url(pub.slice(33, 65)),
      // Already base64url as every VAPID generator prints it; normalised in
      // case somebody pasted standard base64.
      d: privateKey.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function vapidHeader(
  endpoint: string,
  publicKey: string,
  privateKey: string,
  subject: string,
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = bytesToB64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(
    encoder.encode(
      JSON.stringify({
        aud: audience,
        // Twelve hours: comfortably inside the 24 h the spec allows, and long
        // enough that clock skew at either end is irrelevant.
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: subject.startsWith("mailto:") ? subject : `mailto:${subject}`,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const key = await importVapidKey(publicKey, privateKey);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(signingInput)),
  );
  return `vapid t=${signingInput}.${bytesToB64url(signature)}, k=${publicKey}`;
}

// --- payload encryption (RFC 8291) -------------------------------------------

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function encryptPayload(
  subscription: WebSubscription,
  plaintext: string,
): Promise<Uint8Array> {
  const clientPublic = b64urlToBytes(subscription.keys.p256dh);
  const authSecret = b64urlToBytes(subscription.keys.auth);

  // A fresh keypair for every message: the salt and this key are what make two
  // identical notifications encrypt differently.
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const ephemeralPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", ephemeral.publicKey),
  );

  const clientKey = await crypto.subtle.importKey(
    "raw",
    clientPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, ephemeral.privateKey, 256),
  );

  // RFC 8291 §3.3: the pseudo-random key mixes the ECDH secret with the
  // browser's auth secret, and the info string binds both public keys in, so a
  // key derived for one subscriber cannot be replayed at another.
  const prkInfo = concat(
    encoder.encode("WebPush: info\0"),
    clientPublic,
    ephemeralPublic,
  );
  const ikm = await hkdf(authSecret, shared, prkInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  // 0x02 is the last-record delimiter (RFC 8188 §2). One record, so it is the
  // only padding there is.
  const body = concat(encoder.encode(plaintext), new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, [
    "encrypt",
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, tagLength: 128 },
      aesKey,
      body as BufferSource,
    ),
  );

  // aes128gcm header: salt(16) || record size(4, big-endian) || keyid length(1)
  // || keyid, where the keyid is our ephemeral public key.
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  return concat(
    salt,
    recordSize,
    new Uint8Array([ephemeralPublic.length]),
    ephemeralPublic,
    ciphertext,
  );
}

// --- the send ----------------------------------------------------------------

export async function sendWebPush(
  subscription: WebSubscription,
  payload: unknown,
  vapid: { publicKey: string; privateKey: string; subject: string },
  ttlSeconds = 12 * 60 * 60,
): Promise<WebPushOutcome> {
  let body: Uint8Array;
  let authorization: string;
  try {
    body = await encryptPayload(subscription, JSON.stringify(payload));
    authorization = await vapidHeader(
      subscription.endpoint,
      vapid.publicKey,
      vapid.privateKey,
      vapid.subject,
    );
  } catch (e) {
    // A malformed key is a configuration problem, not a dead subscription.
    return { ok: false, gone: false, error: e instanceof Error ? e.message : String(e) };
  }

  let res: Response;
  try {
    res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        authorization,
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(ttlSeconds),
        urgency: "normal",
      },
      body: body as BufferSource,
    });
  } catch (e) {
    return { ok: false, gone: false, error: `web push request failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (res.ok) return { ok: true };

  const detail = (await res.text().catch(() => "")).slice(0, 300);
  // 404/410: the browser threw the subscription away. 410 is the documented
  // one; Chrome has been seen to use 404. Either way there is nothing to
  // retry and the row should go.
  if (res.status === 404 || res.status === 410) {
    return { ok: false, gone: true, error: `web push ${res.status}: ${detail}` };
  }
  return { ok: false, gone: false, error: `web push ${res.status}: ${detail}` };
}
