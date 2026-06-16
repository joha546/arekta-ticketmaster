-- Phase 05: Backfill showtime_seats for showtimes created before fn_populate_showtime_seats trigger

INSERT INTO showtime_seats (showtime_id, seat_id)
SELECT st.id, s.id
FROM showtimes st
INNER JOIN seats s ON s.screen_id = st.screen_id
WHERE NOT EXISTS (
  SELECT 1 FROM showtime_seats ss WHERE ss.showtime_id = st.id
)
ON CONFLICT (showtime_id, seat_id) DO NOTHING;
