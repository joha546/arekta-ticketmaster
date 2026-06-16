-- Phase 05: seat hold and release functions

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

CREATE OR REPLACE FUNCTION fn_release_hold(
  p_hold_id UUID,
  p_user_id UUID
) RETURNS VOID AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE seat_holds
  SET released_at = NOW()
  WHERE id = p_hold_id
    AND user_id = p_user_id
    AND released_at IS NULL
    AND expires_at > NOW();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'HOLD_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  UPDATE showtime_seats ss
  SET
    status = 'available',
    hold_id = NULL,
    version = ss.version + 1,
    updated_at = NOW()
  WHERE ss.hold_id = p_hold_id
    AND ss.status = 'held';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'HOLD_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_expire_hold(p_hold_id UUID) RETURNS INTEGER[] AS $$
DECLARE
  v_seat_ids INTEGER[];
BEGIN
  UPDATE seat_holds
  SET released_at = NOW()
  WHERE id = p_hold_id
    AND released_at IS NULL
    AND expires_at <= NOW();

  IF NOT FOUND THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  WITH released AS (
    UPDATE showtime_seats ss
    SET
      status = 'available',
      hold_id = NULL,
      version = ss.version + 1,
      updated_at = NOW()
    WHERE ss.hold_id = p_hold_id
      AND ss.status = 'held'
    RETURNING ss.seat_id
  )
  SELECT COALESCE(array_agg(seat_id), ARRAY[]::INTEGER[])
  INTO v_seat_ids
  FROM released;

  RETURN v_seat_ids;
END;
$$ LANGUAGE plpgsql;
