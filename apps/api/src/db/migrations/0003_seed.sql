-- Phase 00: Seed data — cinema, screen, seats, genres, admin user

-- Cinema
INSERT INTO cinemas (name, city)
SELECT 'Arekta Cinema', 'Dhaka'
WHERE NOT EXISTS (SELECT 1 FROM cinemas WHERE name = 'Arekta Cinema');

-- Screen (10 rows × 12 cols)
INSERT INTO screens (cinema_id, name, row_count, col_count)
SELECT c.id, 'Screen 1', 10, 12
FROM cinemas c
WHERE c.name = 'Arekta Cinema'
  AND NOT EXISTS (SELECT 1 FROM screens s WHERE s.name = 'Screen 1');

-- Seats A1–J12 (120 total)
DO $$
DECLARE
  v_screen_id SMALLINT;
  row_labels TEXT[] := ARRAY['A','B','C','D','E','F','G','H','I','J'];
  r TEXT;
  c INT;
BEGIN
  SELECT id INTO v_screen_id FROM screens WHERE name = 'Screen 1' LIMIT 1;
  IF v_screen_id IS NULL THEN
    RAISE EXCEPTION 'Screen 1 not found — run cinema/screen seed first';
  END IF;

  FOREACH r IN ARRAY row_labels LOOP
    FOR c IN 1..12 LOOP
      INSERT INTO seats (screen_id, row_label, col_number, label)
      VALUES (v_screen_id, r, c, r || c::TEXT)
      ON CONFLICT (screen_id, row_label, col_number) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- Genres
INSERT INTO genres (name, slug) VALUES
  ('Action', 'action'),
  ('Comedy', 'comedy'),
  ('Drama', 'drama'),
  ('Horror', 'horror'),
  ('Sci-Fi', 'sci-fi'),
  ('Romance', 'romance'),
  ('Thriller', 'thriller'),
  ('Documentary', 'documentary')
ON CONFLICT (name) DO NOTHING;

-- Admin user (password: Admin123!)
INSERT INTO users (email, password_hash, name, role, email_verified_at)
VALUES (
  'admin@arekta.local',
  '$2b$12$lwF4xpuCpVbo2u/yLX/JP.tvv0ZifFXOZsYo50LcmExoq4wf6kIZ6',
  'Admin User',
  'admin',
  NOW()
)
ON CONFLICT (email) DO NOTHING;
