import { queryRead, queryWrite } from '../db/pools.js';

export type ShowtimeStatus = 'scheduled' | 'cancelled' | 'completed';

export type ShowtimeRecord = {
  id: string;
  movieId: string;
  screenId: number;
  startTime: Date;
  endTime: Date;
  priceCents: number;
  status: ShowtimeStatus;
};

export type ShowtimeListItem = {
  id: string;
  startTime: Date;
  endTime: Date;
  priceCents: number;
  status: ShowtimeStatus;
  availableSeatCount: number;
};

export type UpcomingShowtimeRecord = {
  id: string;
  startTime: Date;
  endTime: Date;
  priceCents: number;
  status: ShowtimeStatus;
};

type ShowtimeRow = {
  id: string;
  movie_id: string;
  screen_id: number;
  start_time: Date;
  end_time: Date;
  price_cents: number;
  status: ShowtimeStatus;
};

type ShowtimeListRow = ShowtimeRow & {
  available_seat_count: number;
};

const DEFAULT_SCREEN_ID = 1;

const SHOWTIME_COLUMNS = `
  id, movie_id, screen_id, start_time, end_time, price_cents, status
`;

function mapShowtime(row: ShowtimeRow): ShowtimeRecord {
  return {
    id: row.id,
    movieId: row.movie_id,
    screenId: row.screen_id,
    startTime: row.start_time,
    endTime: row.end_time,
    priceCents: row.price_cents,
    status: row.status,
  };
}

function mapListItem(row: ShowtimeListRow): ShowtimeListItem {
  return {
    id: row.id,
    startTime: row.start_time,
    endTime: row.end_time,
    priceCents: row.price_cents,
    status: row.status,
    availableSeatCount: row.available_seat_count,
  };
}

function mapUpcoming(row: ShowtimeRow): UpcomingShowtimeRecord {
  return {
    id: row.id,
    startTime: row.start_time,
    endTime: row.end_time,
    priceCents: row.price_cents,
    status: row.status,
  };
}

export function isScheduleConflictError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23P01'
  );
}

export async function create(input: {
  movieId: string;
  startTime: Date;
  endTime: Date;
  priceCents: number;
  screenId?: number;
}): Promise<ShowtimeRecord> {
  const result = await queryWrite<ShowtimeRow>(
    `INSERT INTO showtimes (movie_id, screen_id, start_time, end_time, price_cents)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${SHOWTIME_COLUMNS}`,
    [
      input.movieId,
      input.screenId ?? DEFAULT_SCREEN_ID,
      input.startTime,
      input.endTime,
      input.priceCents,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to create showtime');
  }

  return mapShowtime(row);
}

export async function update(
  id: string,
  input: {
    startTime?: Date;
    endTime?: Date;
    priceCents?: number;
  },
): Promise<ShowtimeRecord | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.startTime !== undefined) {
    fields.push(`start_time = $${paramIndex++}`);
    values.push(input.startTime);
  }
  if (input.endTime !== undefined) {
    fields.push(`end_time = $${paramIndex++}`);
    values.push(input.endTime);
  }
  if (input.priceCents !== undefined) {
    fields.push(`price_cents = $${paramIndex++}`);
    values.push(input.priceCents);
  }

  if (fields.length === 0) {
    return findById(id);
  }

  values.push(id);

  const result = await queryWrite<ShowtimeRow>(
    `UPDATE showtimes
     SET ${fields.join(', ')}
     WHERE id = $${paramIndex} AND status = 'scheduled'
     RETURNING ${SHOWTIME_COLUMNS}`,
    values,
  );

  const row = result.rows[0];
  return row ? mapShowtime(row) : null;
}

export async function cancel(id: string): Promise<ShowtimeRecord | null> {
  const result = await queryWrite<ShowtimeRow>(
    `UPDATE showtimes
     SET status = 'cancelled'
     WHERE id = $1 AND status = 'scheduled'
     RETURNING ${SHOWTIME_COLUMNS}`,
    [id],
  );

  const row = result.rows[0];
  return row ? mapShowtime(row) : null;
}

export async function findById(id: string): Promise<ShowtimeRecord | null> {
  const result = await queryRead<ShowtimeRow>(
    `SELECT ${SHOWTIME_COLUMNS}
     FROM showtimes
     WHERE id = $1`,
    [id],
  );

  const row = result.rows[0];
  return row ? mapShowtime(row) : null;
}

export async function listByMovieAndDate(
  movieId: string,
  date: string,
): Promise<ShowtimeListItem[]> {
  const result = await queryRead<ShowtimeListRow>(
    `SELECT
       s.id,
       s.movie_id,
       s.screen_id,
       s.start_time,
       s.end_time,
       s.price_cents,
       s.status,
       COUNT(ss.id) FILTER (WHERE ss.status = 'available')::int AS available_seat_count
     FROM showtimes s
     LEFT JOIN showtime_seats ss ON ss.showtime_id = s.id
     WHERE s.movie_id = $1
       AND s.start_time::date = $2::date
       AND s.status = 'scheduled'
     GROUP BY s.id, s.movie_id, s.screen_id, s.start_time, s.end_time, s.price_cents, s.status
     ORDER BY s.start_time ASC`,
    [movieId, date],
  );

  return result.rows.map(mapListItem);
}

export async function listUpcomingByMovieId(movieId: string): Promise<UpcomingShowtimeRecord[]> {
  const result = await queryRead<ShowtimeRow>(
    `SELECT ${SHOWTIME_COLUMNS}
     FROM showtimes
     WHERE movie_id = $1
       AND status = 'scheduled'
       AND start_time > NOW()
     ORDER BY start_time ASC
     LIMIT 10`,
    [movieId],
  );

  return result.rows.map(mapUpcoming);
}

export async function hasConfirmedReservations(showtimeId: string): Promise<boolean> {
  const result = await queryRead<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM reservations
       WHERE showtime_id = $1 AND status = 'confirmed'
     ) AS exists`,
    [showtimeId],
  );

  return result.rows[0]?.exists ?? false;
}

export async function countSeatsByShowtimeId(showtimeId: string): Promise<number> {
  const result = await queryRead<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM showtime_seats
     WHERE showtime_id = $1`,
    [showtimeId],
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function markCompleted(): Promise<number> {
  const result = await queryWrite(
    `UPDATE showtimes
     SET status = 'completed'
     WHERE status = 'scheduled' AND end_time < NOW()`,
  );

  return result.rowCount ?? 0;
}

export { DEFAULT_SCREEN_ID };
