-- Phase 04: showtime seat population trigger and 15-minute scheduling gap

-- Replace overlap constraint to include 15-minute cleanup buffer after end_time
ALTER TABLE showtimes DROP CONSTRAINT IF EXISTS showtimes_no_overlap;

ALTER TABLE showtimes ADD CONSTRAINT showtimes_no_overlap
  EXCLUDE USING gist (
    screen_id WITH =,
    tstzrange(start_time, end_time + interval '15 minutes', '[)') WITH &&
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
