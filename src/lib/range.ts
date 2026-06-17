// Pure single-range HTTP byte-range parser, validated against a known object size.
export type ParsedRange =
  | { type: 'full' }
  | { type: 'range'; offset: number; length: number }
  | { type: 'unsatisfiable' };

/**
 * Parse a single `Range: bytes=...` header against the total object size.
 * Supports `bytes=start-end`, `bytes=start-` (open-ended), and `bytes=-suffix`.
 * Multi-range / malformed -> 'full' (browsers send single ranges for media;
 * R2 cannot emit multipart/byteranges).
 */
export function parseRange(header: string | null, size: number): ParsedRange {
  if (!header) return { type: 'full' };

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { type: 'full' };

  const [, rawStart, rawEnd] = match;
  if (size === 0) return { type: 'unsatisfiable' };

  // Suffix form: `bytes=-N` -> last N bytes.
  if (rawStart === '') {
    if (rawEnd === '') return { type: 'unsatisfiable' };
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return { type: 'unsatisfiable' };
    const length = Math.min(suffix, size);
    return { type: 'range', offset: size - length, length };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return { type: 'unsatisfiable' };

  // `bytes=start-` (open-ended, e.g. iOS Safari's `bytes=0-` probe) runs to EOF.
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return { type: 'unsatisfiable' };

  return { type: 'range', offset: start, length: end - start + 1 };
}
