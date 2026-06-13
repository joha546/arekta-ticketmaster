import { describe, expect, it } from 'vitest';
import { findAll } from '../../src/genres/repository.js';
import { skipIntegration } from './setup.js';

/** Expected seed slugs from 0003_seed.sql. */
const SEED_SLUGS = [
  'action',
  'comedy',
  'documentary',
  'drama',
  'horror',
  'romance',
  'sci-fi',
  'thriller',
];

/**
 * Integration spec — queries the real database (primary + read replicas).
 * Requires migrated seed data; skipped when INTEGRATION_TEST=0.
 */
describe.skipIf(skipIntegration)('Genres integration', () => {
  it('findAll returns 8 seeded genres from the database', async () => {
    const genres = await findAll();

    expect(genres).toHaveLength(8);
    expect(genres.map((g) => g.slug).sort()).toEqual([...SEED_SLUGS].sort());
  });

  it('findAll returns genres sorted alphabetically by name', async () => {
    const genres = await findAll();

    const names = genres.map((g) => g.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
