-- Phase 04: showtime seat population trigger and 15-minute scheduling gap

-- GiST EXCLUDE requires immutable index expressions. `timestamptz + interval` is only STABLE,
-- so maintain scheduling_end via trigger and reference the stored column in the constraint.
ALTER TABLE showtimes
  ADD COLUMN IF NOT EXISTS scheduling_end TIMESTAMPTZ;

UPDATE showtimes
SET scheduling_end = end_time + INTERVAL '15 minutes'
WHERE scheduling_end IS NULL;

ALTER TABLE showtimes
  ALTER COLUMN scheduling_end SET NOT NULL;

CREATE OR REPLACE FUNCTION fn_set_showtime_scheduling_end()
RETURNS TRIGGER AS $$
BEGIN
  NEW.scheduling_end := NEW.end_time + INTERVAL '15 minutes';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS showtimes_set_scheduling_end ON showtimes;
CREATE TRIGGER showtimes_set_scheduling_end
  BEFORE INSERT OR UPDATE OF end_time ON showtimes
  FOR EACH ROW EXECUTE FUNCTION fn_set_showtime_scheduling_end();

ALTER TABLE showtimes DROP CONSTRAINT IF EXISTS showtimes_no_overlap;

ALTER TABLE showtimes ADD CONSTRAINT showtimes_no_overlap
  EXCLUDE USING gist (
    screen_id WITH =,
    tstzrange(start_time, scheduling_end, '[)') WITH &&
  ) WHERE (status = 'scheduled');

-- Populate showtime_seats from screen seats on every new showtime
CREATE OR REPLACE FUNCTION fn_populate_showtime_seats()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO showtime_seats (showtime_id, seat_id)
  SELECT NEW.id, s.id
  FROM seats s
  WHERE s.screen_id = NEW.screen_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS showtimes_populate_seats ON showtimes;
CREATE TRIGGER showtimes_populate_seats
  AFTER INSERT ON showtimes
  FOR EACH ROW EXECUTE FUNCTION fn_populate_showtime_seats();
