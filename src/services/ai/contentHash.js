// services/ai/contentHash.js
//
// Server-side ONLY: imported by api/visualize.mjs, never by client code —
// same convention GroqService.js/GeminiService.js already document, and
// for the same practical reason this time: `node:crypto` isn't something
// webpack 5 (react-scripts 5's bundler, no automatic Node core-module
// polyfills) can resolve into a browser bundle, so this file would break
// `npm run build` the moment anything under src/components or src/lib
// imported it. Nothing does, and nothing should.
//
// A sha256 of (entry notes + extra context) is the whole mechanism behind
// entry_visualizations.source_content_hash — see that migration's own
// comment and api/visualize.mjs for how it's used to detect a stale cached
// diagram without needing a separate "dirty" flag anywhere.

import { createHash } from 'node:crypto';

/**
 * Deterministic hash of exactly the inputs that can change what a
 * visualization generation produces: the entry's own notes, and whatever
 * optional extra medical context the user supplied for this specific
 * generation. A NUL separator keeps ("ab", "c") from hashing the same as
 * ("a", "bc") — not realistic for free-text medical notes, but free to
 * rule out and exactly the kind of edge case a cache key should never rely
 * on "probably never happens" for.
 *
 * Deliberately NOT including vizType — callers key their cache lookup by
 * (entry_id, viz_type, hash) together (see entry_visualizations' own
 * unique constraint), so the same hash naturally yields independent cache
 * entries per visualization type without needing to fold the type into
 * the hash itself.
 */
export function computeContentHash(notes, extraContext) {
  const normalizedNotes = String(notes || '');
  const normalizedContext = String(extraContext || '').trim();
  return createHash('sha256')
    .update(normalizedNotes, 'utf8')
    .update('\u0000')
    .update(normalizedContext, 'utf8')
    .digest('hex');
}
