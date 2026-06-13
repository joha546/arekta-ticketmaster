import { queryRead } from '../db/pools.js';

/** Public genre shape returned by GET /genres. */
export type GenreRecord = {
  id: number;
  name: string;
  slug: string;
};

type GenreRow = {
  id: number;
  name: string;
  slug: string;
};

function mapGenre(row: GenreRow): GenreRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
  };
}

/**
 * Data access for the `genres` reference table.
 * All reads go through read replicas via `queryRead`.
 */
export async function findAll(): Promise<GenreRecord[]> {
  const result = await queryRead<GenreRow>(
    `SELECT id, name, slug
     FROM genres
     ORDER BY name ASC`,
  );
  return result.rows.map(mapGenre);
}
