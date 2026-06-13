import {
  bigint,
  bigserial,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  smallserial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const userRoleEnum = pgEnum('user_role', ['admin', 'user']);
export const showtimeStatusEnum = pgEnum('showtime_status', [
  'scheduled',
  'cancelled',
  'completed',
]);
export const seatStatusEnum = pgEnum('seat_status', ['available', 'held', 'reserved']);
export const reservationStatusEnum = pgEnum('reservation_status', [
  'pending',
  'confirmed',
  'expired',
  'cancelled',
]);
export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'completed',
  'failed',
  'refunded',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: text('password_hash'),
    name: varchar('name', { length: 255 }).notNull(),
    role: userRoleEnum('role').notNull().default('user'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    googleId: text('google_id').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('users_email_idx').on(table.email)],
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('email_verification_tokens_user_id_idx').on(table.userId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 100 }).notNull(),
    targetType: varchar('target_type', { length: 50 }),
    targetId: uuid('target_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_actor_id_idx').on(table.actorId),
    index('audit_logs_created_at_idx').on(table.createdAt),
  ],
);

export const cinemas = pgTable('cinemas', {
  id: smallserial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  city: varchar('city', { length: 100 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const screens = pgTable('screens', {
  id: smallserial('id').primaryKey(),
  cinemaId: smallint('cinema_id')
    .notNull()
    .references(() => cinemas.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  rowCount: smallint('row_count').notNull(),
  colCount: smallint('col_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const seats = pgTable(
  'seats',
  {
    id: serial('id').primaryKey(),
    screenId: smallint('screen_id')
      .notNull()
      .references(() => screens.id, { onDelete: 'cascade' }),
    rowLabel: char('row_label', { length: 1 }).notNull(),
    colNumber: smallint('col_number').notNull(),
    label: varchar('label', { length: 10 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('seats_screen_row_col_unique').on(table.screenId, table.rowLabel, table.colNumber),
    unique('seats_screen_label_unique').on(table.screenId, table.label),
  ],
);

export const genres = pgTable('genres', {
  id: smallserial('id').primaryKey(),
  name: varchar('name', { length: 60 }).notNull().unique(),
  slug: varchar('slug', { length: 60 }).notNull().unique(),
});

export const movies = pgTable(
  'movies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    posterUrl: text('poster_url'),
    runtimeMinutes: smallint('runtime_minutes').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('movies_is_active_idx').on(table.isActive)],
);

export const movieGenres = pgTable(
  'movie_genres',
  {
    movieId: uuid('movie_id')
      .notNull()
      .references(() => movies.id, { onDelete: 'cascade' }),
    genreId: smallint('genre_id')
      .notNull()
      .references(() => genres.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.movieId, table.genreId] })],
);

export const showtimes = pgTable(
  'showtimes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    movieId: uuid('movie_id')
      .notNull()
      .references(() => movies.id, { onDelete: 'restrict' }),
    screenId: smallint('screen_id')
      .notNull()
      .references(() => screens.id, { onDelete: 'restrict' }),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    priceCents: integer('price_cents').notNull(),
    status: showtimeStatusEnum('status').notNull().default('scheduled'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('showtimes_movie_id_start_time_idx').on(table.movieId, table.startTime),
    index('showtimes_screen_id_start_time_idx').on(table.screenId, table.startTime),
  ],
);

export const seatHolds = pgTable(
  'seat_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('seat_holds_showtime_id_idx').on(table.showtimeId),
    index('seat_holds_expires_at_idx').on(table.expiresAt),
  ],
);

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    referenceCode: varchar('reference_code', { length: 20 }).notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'restrict' }),
    holdId: uuid('hold_id').references(() => seatHolds.id, { onDelete: 'set null' }),
    status: reservationStatusEnum('status').notNull().default('pending'),
    totalAmountCents: integer('total_amount_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('reservations_user_id_idx').on(table.userId),
    index('reservations_showtime_id_idx').on(table.showtimeId),
    index('reservations_status_idx').on(table.status),
    unique('reservations_user_idempotency_unique').on(table.userId, table.idempotencyKey),
  ],
);

export const showtimeSeats = pgTable(
  'showtime_seats',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'cascade' }),
    seatId: integer('seat_id')
      .notNull()
      .references(() => seats.id, { onDelete: 'restrict' }),
    status: seatStatusEnum('status').notNull().default('available'),
    version: integer('version').notNull().default(0),
    holdId: uuid('hold_id').references(() => seatHolds.id, { onDelete: 'set null' }),
    reservationId: uuid('reservation_id').references(() => reservations.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('showtime_seats_showtime_seat_unique').on(table.showtimeId, table.seatId),
    index('showtime_seats_showtime_id_status_idx').on(table.showtimeId, table.status),
  ],
);

export const reservationSeats = pgTable(
  'reservation_seats',
  {
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    showtimeSeatId: bigint('showtime_seat_id', { mode: 'number' })
      .notNull()
      .references(() => showtimeSeats.id, { onDelete: 'restrict' }),
  },
  (table) => [primaryKey({ columns: [table.reservationId, table.showtimeSeatId] })],
);

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  reservationId: uuid('reservation_id')
    .notNull()
    .unique()
    .references(() => reservations.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 50 }).notNull().default('stripe'),
  providerPaymentIntentId: text('provider_payment_intent_id').unique(),
  status: paymentStatusEnum('status').notNull().default('pending'),
  amountCents: integer('amount_cents').notNull(),
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  gatewayResponse: jsonb('gateway_response').notNull().default({}),
  providerRefundId: text('provider_refund_id'),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const reportingDailySnapshots = pgTable(
  'reporting_daily_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    snapshotDate: date('snapshot_date').notNull(),
    movieId: uuid('movie_id').references(() => movies.id, { onDelete: 'set null' }),
    revenueCents: bigint('revenue_cents', { mode: 'number' }).notNull().default(0),
    reservationCount: integer('reservation_count').notNull().default(0),
    seatsSoldCount: integer('seats_sold_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('reporting_daily_snapshots_date_movie_idx').on(
      table.snapshotDate,
      sql`COALESCE(${table.movieId}, '00000000-0000-0000-0000-000000000000'::UUID)`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Genre = typeof genres.$inferSelect;
export type Movie = typeof movies.$inferSelect;
export type Showtime = typeof showtimes.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
