-- Phase 00: Core schema — extensions, enums, all tables, indexes, constraints, trigger stubs

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drop placeholder from 0001_init.sql
DROP TABLE IF EXISTS events;

-- Enums
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'user');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE showtime_status AS ENUM ('scheduled', 'cancelled', 'completed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE seat_status AS ENUM ('available', 'held', 'reserved');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reservation_status AS ENUM ('pending', 'confirmed', 'expired', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT,
  name VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  email_verified_at TIMESTAMPTZ,
  google_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- email_verification_tokens
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_id_idx
  ON email_verification_tokens (user_id);

-- audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at);

-- cinemas
CREATE TABLE IF NOT EXISTS cinemas (
  id SMALLSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- screens
CREATE TABLE IF NOT EXISTS screens (
  id SMALLSERIAL PRIMARY KEY,
  cinema_id SMALLINT NOT NULL REFERENCES cinemas (id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  row_count SMALLINT NOT NULL,
  col_count SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- seats
CREATE TABLE IF NOT EXISTS seats (
  id SERIAL PRIMARY KEY,
  screen_id SMALLINT NOT NULL REFERENCES screens (id) ON DELETE CASCADE,
  row_label CHAR(1) NOT NULL,
  col_number SMALLINT NOT NULL,
  label VARCHAR(10) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (screen_id, row_label, col_number),
  UNIQUE (screen_id, label)
);

-- genres
CREATE TABLE IF NOT EXISTS genres (
  id SMALLSERIAL PRIMARY KEY,
  name VARCHAR(60) NOT NULL UNIQUE,
  slug VARCHAR(60) NOT NULL UNIQUE
);

-- movies
CREATE TABLE IF NOT EXISTS movies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  poster_url TEXT,
  runtime_minutes SMALLINT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS movies_is_active_idx ON movies (is_active);
CREATE INDEX IF NOT EXISTS movies_search_idx
  ON movies USING gin (title gin_trgm_ops, description gin_trgm_ops);

-- movie_genres
CREATE TABLE IF NOT EXISTS movie_genres (
  movie_id UUID NOT NULL REFERENCES movies (id) ON DELETE CASCADE,
  genre_id SMALLINT NOT NULL REFERENCES genres (id) ON DELETE CASCADE,
  PRIMARY KEY (movie_id, genre_id)
);

-- showtimes
CREATE TABLE IF NOT EXISTS showtimes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL REFERENCES movies (id) ON DELETE RESTRICT,
  screen_id SMALLINT NOT NULL REFERENCES screens (id) ON DELETE RESTRICT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  status showtime_status NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS showtimes_movie_id_start_time_idx
  ON showtimes (movie_id, start_time);
CREATE INDEX IF NOT EXISTS showtimes_screen_id_start_time_idx
  ON showtimes (screen_id, start_time);

DO $$ BEGIN
  ALTER TABLE showtimes ADD CONSTRAINT showtimes_no_overlap
    EXCLUDE USING gist (
      screen_id WITH =,
      tstzrange(start_time, end_time, '[)') WITH &&
    ) WHERE (status = 'scheduled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- seat_holds
CREATE TABLE IF NOT EXISTS seat_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  showtime_id UUID NOT NULL REFERENCES showtimes (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS seat_holds_showtime_id_idx ON seat_holds (showtime_id);
CREATE INDEX IF NOT EXISTS seat_holds_expires_at_idx
  ON seat_holds (expires_at) WHERE released_at IS NULL;

-- reservations
CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code VARCHAR(20) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  showtime_id UUID NOT NULL REFERENCES showtimes (id) ON DELETE RESTRICT,
  hold_id UUID REFERENCES seat_holds (id) ON DELETE SET NULL,
  status reservation_status NOT NULL DEFAULT 'pending',
  total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  idempotency_key VARCHAR(255),
  expires_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS reservations_user_id_idx ON reservations (user_id);
CREATE INDEX IF NOT EXISTS reservations_showtime_id_idx ON reservations (showtime_id);
CREATE INDEX IF NOT EXISTS reservations_status_idx ON reservations (status);

-- showtime_seats
CREATE TABLE IF NOT EXISTS showtime_seats (
  id BIGSERIAL PRIMARY KEY,
  showtime_id UUID NOT NULL REFERENCES showtimes (id) ON DELETE CASCADE,
  seat_id INTEGER NOT NULL REFERENCES seats (id) ON DELETE RESTRICT,
  status seat_status NOT NULL DEFAULT 'available',
  version INTEGER NOT NULL DEFAULT 0,
  hold_id UUID REFERENCES seat_holds (id) ON DELETE SET NULL,
  reservation_id UUID REFERENCES reservations (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (showtime_id, seat_id)
);

CREATE INDEX IF NOT EXISTS showtime_seats_showtime_id_status_idx
  ON showtime_seats (showtime_id, status);

-- reservation_seats
CREATE TABLE IF NOT EXISTS reservation_seats (
  reservation_id UUID NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  showtime_seat_id BIGINT NOT NULL REFERENCES showtime_seats (id) ON DELETE RESTRICT,
  PRIMARY KEY (reservation_id, showtime_seat_id)
);

-- payments
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL UNIQUE REFERENCES reservations (id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL DEFAULT 'stripe',
  provider_payment_intent_id TEXT UNIQUE,
  status payment_status NOT NULL DEFAULT 'pending',
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  gateway_response JSONB NOT NULL DEFAULT '{}',
  provider_refund_id TEXT,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- reporting_daily_snapshots
CREATE TABLE IF NOT EXISTS reporting_daily_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  movie_id UUID REFERENCES movies (id) ON DELETE SET NULL,
  revenue_cents BIGINT NOT NULL DEFAULT 0,
  reservation_count INTEGER NOT NULL DEFAULT 0,
  seats_sold_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS reporting_daily_snapshots_date_movie_idx
  ON reporting_daily_snapshots (
    snapshot_date,
    COALESCE(movie_id, '00000000-0000-0000-0000-000000000000'::UUID)
  );

-- Trigger/function stubs (full implementations in later phases)
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_populate_showtime_seats()
RETURNS TRIGGER AS $$
BEGIN
  -- Implemented in Phase 04
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_hold_seats(
  p_hold_id UUID,
  p_user_id UUID,
  p_showtime_id UUID,
  p_seat_ids INTEGER[],
  p_expires_at TIMESTAMPTZ
) RETURNS VOID AS $$
BEGIN
  -- Implemented in Phase 05
  RAISE EXCEPTION 'fn_hold_seats not implemented';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_expire_pending_reservations()
RETURNS INTEGER AS $$
BEGIN
  -- Implemented in Phase 06
  RETURN 0;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_confirm_reservation(
  p_reservation_id UUID,
  p_payment_intent_id TEXT
) RETURNS VOID AS $$
BEGIN
  -- Implemented in Phase 07
  RAISE EXCEPTION 'fn_confirm_reservation not implemented';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS movies_updated_at ON movies;
CREATE TRIGGER movies_updated_at
  BEFORE UPDATE ON movies
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS showtimes_updated_at ON showtimes;
CREATE TRIGGER showtimes_updated_at
  BEFORE UPDATE ON showtimes
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS reservations_updated_at ON reservations;
CREATE TRIGGER reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS payments_updated_at ON payments;
CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
