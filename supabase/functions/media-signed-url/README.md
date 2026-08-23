# media-signed-url (P4.5, SG-5)

Mints short-lived signed URLs for exactly the media the caller is allowed to
see.

    POST /functions/v1/media-signed-url
    Authorization: Bearer <the member's JWT>
    { "album_id": "<uuid>" }        # every showable item in the album
    { "item_id":  "<uuid>" }        # that one item, if it is showable for them

    → 200 [ { "id", "url", "expires_at", "content_type", "caption" } ]

**`verify_jwt = true`.**

## How the consent filter stays honest

The function holds the service key — it has to, to sign anything — so the
authorisation must not come from it. `media_gallery(album_id)` is called with a
**user-scoped client**, so `can_view_album()` and `media_item_showable()` run as
the caller: subjects confirmed (untagged fails closed), nothing redacted or
quarantined, and every minor subject holding an active consent for the album's
purpose. Only the paths that query returned are signed. The service client never
widens the set.

Resolving `item_id` costs one service-client read of `media_items.album_id` —
`authenticated` has no SELECT on that table by design. It yields an album id and
nothing else, and the item is still only signed if the caller's own gallery
query contains it.

## TTL

`site_settings['media.signed_url_ttl_seconds']` (default 900), floored at 60 and
**capped at 900** in code — a setting cannot be edited into a long-lived link.
`expires_at` in the response is the client's cue to re-request rather than cache.

## Secrets

None of its own.
