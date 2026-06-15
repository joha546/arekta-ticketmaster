-- Phase 04: Seed demo movie and future showtimes for Phase 05 manual testing

INSERT INTO movies (title, description, runtime_minutes, is_active)
SELECT 'The Matrix Resurrections Demo', 'Seed movie for showtime testing', 148, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM movies WHERE title = 'The Matrix Resurrections Demo'
);

INSERT INTO movie_genres (movie_id, genre_id)
SELECT m.id, g.id
FROM movies m
INNER JOIN genres g ON g.slug IN ('action', 'sci-fi')
WHERE m.title = 'The Matrix Resurrections Demo'
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_movie_id UUID;
  v_screen_id SMALLINT;
  v_start_1 TIMESTAMPTZ;
  v_start_2 TIMESTAMPTZ;
BEGIN
  SELECT id INTO v_movie_id
  FROM movies
  WHERE title = 'The Matrix Resurrections Demo'
  LIMIT 1;

  SELECT id INTO v_screen_id FROM screens WHERE name = 'Screen 1' LIMIT 1;

  IF v_movie_id IS NULL OR v_screen_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM showtimes WHERE movie_id = v_movie_id) THEN
    RETURN;
  END IF;

  v_start_1 := date_trunc('day', NOW() + interval '7 days') + interval '18 hours';
  v_start_2 := v_start_1 + interval '4 hours';

  INSERT INTO showtimes (movie_id, screen_id, start_time, end_time, price_cents, status)
  VALUES
    (
      v_movie_id,
      v_screen_id,
      v_start_1,
      v_start_1 + interval '148 minutes',
      1500,
      'scheduled'
    ),
    (
      v_movie_id,
      v_screen_id,
      v_start_2,
      v_start_2 + interval '148 minutes',
      1500,
      'scheduled'
    );
END $$;
