-- Fix fn_hold_seats: insert seat_holds before updating showtime_seats.hold_id (FK order)

CREATE OR REPLACE FUNCTION fn_hold_seats(
  p_hold_id UUID,
  p_user_id UUID,
  p_showtime_id UUID,
  p_seat_ids INTEGER[],
  p_expires_at TIMESTAMPTZ
) RETURNS VOID AS $$
DECLARE
  v_expected INTEGER;
  v_found INTEGER;
  v_available INTEGER;
  v_updated INTEGER;
BEGIN
  v_expected := array_length(p_seat_ids, 1);
  IF v_expected IS NULL OR v_expected = 0 THEN
    RAISE EXCEPTION 'SEATS_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM showtime_seats ss
  WHERE ss.showtime_id = p_showtime_id
    AND ss.seat_id = ANY (p_seat_ids)
  FOR UPDATE;

  SELECT COUNT(*)::int, COUNT(*) FILTER (WHERE ss.status = 'available')::int
  INTO v_found, v_available
  FROM showtime_seats ss
  WHERE ss.showtime_id = p_showtime_id
    AND ss.seat_id = ANY (p_seat_ids);

  IF v_found <> v_expected OR v_available <> v_expected THEN
    RAISE EXCEPTION 'SEATS_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO seat_holds (id, user_id, showtime_id, expires_at)
  VALUES (p_hold_id, p_user_id, p_showtime_id, p_expires_at);

  UPDATE showtime_seats ss
  SET
    status = 'held',
    hold_id = p_hold_id,
    version = ss.version + 1,
    updated_at = NOW()
  WHERE ss.showtime_id = p_showtime_id
    AND ss.seat_id = ANY (p_seat_ids)
    AND ss.status = 'available';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_expected THEN
    RAISE EXCEPTION 'SEATS_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;
END;
$$ LANGUAGE plpgsql;
