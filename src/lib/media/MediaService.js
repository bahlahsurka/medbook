// lib/media/MediaService.js
//
// THE storage abstraction. Per spec §3/§7: nothing in the UI, and nothing in
// the importer, should know or care which provider actually holds a file.
//
// Why this matters concretely — during this project the permanent-media
// decision changed twice (Supabase -> R2), and R2 setup is currently blocked
// on billing. Everything downstream of this file was written without knowing
// the final answer, and none of it needs to change when the answer lands.
//
// Two things are deliberately separated:
//
//   StorageProvider — knows how to put/get/delete bytes somewhere.
//                     Swappable. Currently R2; could be anything.
//
//   MediaService    — knows about MedBook's media semantics: content-hash
//                     dedup, Anki-filename -> URL resolution, user scoping.
//                     Provider-independent.
//
// RENDER-TIME RESOLUTION (the chosen design): imported card HTML keeps its
// ORIGINAL Anki filenames. resolveMany() turns those into real URLs at display
// time. That's what keeps card content provider-independent forever.

import { createHash } from 'crypto';

/* ------------------------------------------------------------------ */
/* Provider interface                                                  */
/* ------------------------------------------------------------------ */

/**
 * Any storage backend must implement this shape. Keeping it this small is
 * intentional — a provider that can put, get a URL, and delete is enough.
 *
 *   put(key, body, contentType) -> { key, size }
 *   getUrl(key, { expiresIn })  -> string
 *   delete(keys[])              -> void
 */

/** Cloudflare R2 (S3-compatible). */
export class R2Provider {
  constructor({ accountId, accessKeyId, secretAccessKey, bucket }) {
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error('R2Provider: missing config. Check R2_* environment variables.');
    }
    this.bucket = bucket;
    this._config = { accountId, accessKeyId, secretAccessKey };
    this._client = null;
  }

  // Lazily constructed so importing this module never requires the AWS SDK
  // to be present unless R2 is actually used — keeps the web bundle and any
  // non-R2 code path free of it.
  async _getClient() {
    if (this._client) return this._client;
    const { S3Client } = await import('@aws-sdk/client-s3');
    const { accountId, accessKeyId, secretAccessKey } = this._config;
    this._client = new S3Client({
      region: 'auto',                                   // R2 requires 'auto'
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    return this._client;
  }

  async put(key, body, contentType) {
    const client = await this._getClient();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    }));
    return { key, size: body.length };
  }

  /**
   * Presigned URL. R2 buckets are private by default, so media is served via
   * time-limited signed URLs rather than being made publicly readable —
   * one user's study material stays inaccessible to anyone else (spec §9).
   */
  async getUrl(key, { expiresIn = 3600 } = {}) {
    const client = await this._getClient();
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }

  async delete(keys) {
    if (!keys?.length) return;
    const client = await this._getClient();
    const { DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
    // S3 delete-objects caps at 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) {
      await client.send(new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: keys.slice(i, i + 1000).map(Key => ({ Key })) },
      }));
    }
  }
}

/**
 * Supabase Storage — NOT used for imported deck media (1GB free tier is far
 * too small; one real deck is ~900MB). Implemented anyway because existing
 * Review Entry images already live there, so MediaService can resolve BOTH
 * kinds through one interface without migrating anything (spec §3/§26).
 */
export class SupabaseProvider {
  constructor({ client, bucket = 'entry-images' }) {
    if (!client) throw new Error('SupabaseProvider: missing supabase client.');
    this.client = client;
    this.bucket = bucket;
  }

  async put(key, body, contentType) {
    const { error } = await this.client.storage.from(this.bucket)
      .upload(key, body, { contentType: contentType || 'application/octet-stream' });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    return { key, size: body.length };
  }

  async getUrl(key) {
    const { data } = this.client.storage.from(this.bucket).getPublicUrl(key);
    return data.publicUrl;
  }

  async delete(keys) {
    if (!keys?.length) return;
    const { error } = await this.client.storage.from(this.bucket).remove(keys);
    if (error) throw new Error(`Supabase delete failed: ${error.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* MediaService                                                        */
/* ------------------------------------------------------------------ */

export class MediaService {
  /**
   * @param providers  map of name -> provider instance, e.g. { r2, supabase }
   * @param defaultProvider  which one NEW imported media goes to
   * @param db  supabase client, for the imported_media table
   */
  constructor({ providers, defaultProvider = 'r2', db }) {
    this.providers = providers;
    this.defaultProvider = defaultProvider;
    this.db = db;
  }

  _provider(name) {
    const p = this.providers[name];
    if (!p) throw new Error(`MediaService: no provider registered named "${name}".`);
    return p;
  }

  /** sha256 of the bytes — the dedup key. */
  static hash(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Store one media file for an imported deck, deduplicating within that deck.
   *
   * If the same BYTES already exist for this deck, nothing is uploaded again —
   * the existing stored object is reused. Every card referencing the file still
   * renders it normally; we just don't pay to store 30 identical copies.
   *
   * Returns { deduped: boolean, storageKey, mediaId }.
   */
  async storeImportedMedia({ userId, rootDeckId, ankiFilename, buffer, contentType }) {
    const contentHash = MediaService.hash(buffer);

    // Already stored these exact bytes for this deck? Determines whether we
    // need to upload at all, and if not, which existing object to point at.
    const { data: existing } = await this.db
      .from('imported_media')
      .select('id, storage_key, storage_provider')
      .eq('root_deck_id', rootDeckId)
      .eq('content_hash', contentHash)
      .limit(1);

    const hit = existing?.[0];
    const providerName = hit?.storage_provider || this.defaultProvider;
    const storageKey = hit?.storage_key || `${userId}/${rootDeckId}/${contentHash}`;

    // Only upload if these bytes genuinely aren't stored yet for this deck.
    if (!hit) {
      await this._provider(providerName).put(storageKey, buffer, contentType);
    }

    // RACE HANDLING — history worth recording, because the fix changed twice:
    //
    // v1 (original): a separate "does this exist" SELECT, then a plain
    // INSERT. Real race window between the two — a resumed job invocation
    // and a manual retry overlapped in production and crashed with a
    // duplicate-key violation.
    //
    // v2: switched to upsert(..., { onConflict, ignoreDuplicates: true }),
    // proven correct against raw SQL and against this file's own test
    // harness — but the SAME crash still happened in production afterward.
    // That's a real signal: I had verified the SQL pattern works, but never
    // verified that supabase-js's upsert() options are being interpreted
    // correctly by the actual PostgREST version in this project — a gap
    // between "correct in theory" and "correct in this deployment."
    //
    // v3 (this version): plain INSERT, with the ONE thing about a duplicate
    // that's actually guaranteed stable — Postgres's own unique_violation
    // SQLSTATE code, 23505 — caught explicitly and treated as a successful
    // dedup rather than a failure. This depends on nothing but standard
    // Postgres error codes, not on any ORM-level option being parsed a
    // particular way, which is a strictly smaller set of assumptions than
    // v2 relied on.
    const { data: inserted, error } = await this.db
      .from('imported_media')
      .insert({
        user_id: userId,
        root_deck_id: rootDeckId,
        anki_filename: ankiFilename,
        content_hash: contentHash,
        storage_provider: providerName,
        storage_key: storageKey,
        content_type: contentType,
        size_bytes: buffer.length,
      })
      .select('id')
      .single();

    if (error) {
      // Two independent ways to detect "this was a duplicate, not a real
      // failure" — the standardized code, AND a direct match on the literal
      // error text. Belt and suspenders: if error.code isn't coming through
      // exactly as PostgrestError's type definitions suggest it should in
      // this specific environment, the message-content check still catches
      // it, because this exact string has now been observed directly in
      // production three times — it's no longer a guess.
      const isDuplicate = error.code === '23505'
        || /duplicate key value violates unique constraint/i.test(error.message || '')
        || /imported_media_dedup_idx/i.test(error.message || '');

      if (isDuplicate) {
        const { data: winner } = await this.db
          .from('imported_media')
          .select('id')
          .eq('root_deck_id', rootDeckId)
          .eq('content_hash', contentHash)
          .eq('anki_filename', ankiFilename)
          .single();
        return { deduped: true, storageKey, mediaId: winner?.id };
      }

      // Genuinely unexpected — log AND surface the RAW fields. Logging
      // separately (not just embedding in the thrown message) means the
      // raw shape still reaches Vercel's function logs even if whatever
      // reads the thrown error only surfaces a truncated/summarized
      // version of it upstream.
      console.error('[MediaService.storeImportedMedia] unexpected error', {
        code: error.code, message: error.message, details: error.details, hint: error.hint,
        rootDeckId, ankiFilename, contentHash,
      });
      throw new Error(`Failed to record media: ${error.message} [code=${error.code}, details=${error.details}, hint=${error.hint}]`);
    }

    return { deduped: !!hit, storageKey, mediaId: inserted.id };
  }

  /**
   * Resolve Anki filenames -> real URLs. THE render-time hot path.
   *
   * Batched deliberately: a single card can reference several images, and a
   * study session moves fast. One query for all filenames on a card beats N
   * separate lookups.
   *
   * Unknown filenames resolve to null rather than throwing — a card missing
   * one image should still render, not blow up the whole study session.
   */
  async resolveMany({ rootDeckId, filenames, expiresIn = 3600 }) {
    if (!filenames?.length) return {};

    const unique = [...new Set(filenames)];
    const { data, error } = await this.db
      .from('imported_media')
      .select('anki_filename, storage_key, storage_provider')
      .eq('root_deck_id', rootDeckId)
      .in('anki_filename', unique);

    if (error) throw new Error(`Media lookup failed: ${error.message}`);

    const out = {};
    for (const name of unique) out[name] = null;

    // Two genuinely different failure classes were both silently collapsing
    // into the same "image unavailable" with zero trace of which one it
    // actually was: (a) no imported_media row at all for this filename
    // under this root_deck_id, vs (b) a row WAS found but getUrl() failed
    // (e.g. the provider it was stored under isn't registered right now —
    // missing/misconfigured credentials, same class of bug as
    // BLOB_READ_WRITE_TOKEN). Logged separately so a real failure is
    // actually diagnosable instead of just "images don't show up".
    const foundNames = new Set((data || []).map(r => r.anki_filename));
    const missingNames = unique.filter(n => !foundNames.has(n));
    if (missingNames.length) {
      console.error('[MediaService.resolveMany] no imported_media row found', { rootDeckId, missingNames });
    }

    await Promise.all((data || []).map(async row => {
      try {
        out[row.anki_filename] = await this._provider(row.storage_provider)
          .getUrl(row.storage_key, { expiresIn });
      } catch (e) {
        console.error('[MediaService.resolveMany] getUrl failed', {
          filename: row.anki_filename, storageProvider: row.storage_provider,
          storageKey: row.storage_key, message: e.message,
        });
        out[row.anki_filename] = null;   // provider hiccup shouldn't break the card
      }
    }));

    return out;
  }

  /**
   * Delete every stored object for a deck. Called ONLY when the user
   * explicitly deletes that deck (spec §14/§26 — never automatic cleanup,
   * never "unused media" pruning; media is study material).
   *
   * Deletes by DISTINCT storage_key: with dedup, several filename rows can
   * point at one object, and it must be removed exactly once.
   */
  async deleteDeckMedia({ rootDeckId }) {
    const { data, error } = await this.db
      .from('imported_media')
      .select('storage_key, storage_provider')
      .eq('root_deck_id', rootDeckId);

    if (error) throw new Error(`Could not list deck media: ${error.message}`);
    if (!data?.length) return { deletedObjects: 0 };

    const byProvider = {};
    for (const row of data) {
      (byProvider[row.storage_provider] ||= new Set()).add(row.storage_key);
    }

    let deleted = 0;
    for (const [providerName, keys] of Object.entries(byProvider)) {
      const list = [...keys];
      await this._provider(providerName).delete(list);
      deleted += list.length;
    }

    // Rows themselves are removed by the ON DELETE CASCADE from imported_decks.
    return { deletedObjects: deleted };
  }
}

/**
 * Build a MediaService from environment variables. Single place where
 * provider config is read — nothing else in the codebase touches R2 details.
 */
export function createMediaService({ db }) {
  const providers = {};

  if (process.env.R2_ACCOUNT_ID) {
    providers.r2 = new R2Provider({
      accountId: process.env.R2_ACCOUNT_ID,
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      bucket: process.env.R2_BUCKET_NAME,
    });
  }

  if (db) providers.supabase = new SupabaseProvider({ client: db });

  return new MediaService({
    providers,
    defaultProvider: providers.r2 ? 'r2' : 'supabase',
    db,
  });
}
