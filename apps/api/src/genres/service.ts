import * as genresRepo from './repository.js';
import type { GenreRecord } from './repository.js';

/**
 * Business logic for genre reference data.
 * Genres are seed-only in Phase 1 — no create/update/delete operations.
 */
export function createGenresService() {
  /**
   * Returns the full genre list for browse filters and admin movie forms.
   * Sorted alphabetically by name (ordering enforced in the repository).
   */
  async function listGenres(): Promise<{ genres: GenreRecord[] }> {
    const genres = await genresRepo.findAll();
    return { genres };
  }

  return { listGenres };
}
