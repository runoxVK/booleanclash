/**
 * Best score per puzzle, kept in localStorage.
 *
 * Deliberately just a score map — no circuits, no timestamps. When accounts and
 * a server arrive this becomes the local mirror of a server record, and anything
 * richer stored here now would be a migration to write later. Storage is treated
 * as untrusted: a corrupt or hand-edited blob is discarded rather than crashing
 * the game.
 */

const STORAGE_KEY = 'logiclash.progress.v1';

export type Progress = Readonly<Record<string, number>>;

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};

    const clean: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        clean[id] = value;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

/** Record a solve, keeping only the best. Returns the updated map. */
export function recordSolve(
  progress: Progress,
  puzzleId: string,
  score: number,
): Progress {
  const previous = progress[puzzleId];
  if (previous !== undefined && previous <= score) return progress;

  const next = { ...progress, [puzzleId]: score };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private browsing or a full quota. Losing history is not worth a crash.
  }
  return next;
}

export function clearProgress(): Progress {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing useful to do.
  }
  return {};
}
