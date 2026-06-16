-- Phase 06: reservation create, cancel, and expiry functions

CREATE OR REPLACE FUNCTION fn_create_reservation(
  p_hold_id UUID,
  p_user_id UUID,
  p_idempotency_key VARCHAR(255),
  p_reference_code VARCHAR(20),
  p_expires_at TIMESTAMPTZ
) RETURNS UUID AS $$
DECLARE
  v_hold RECORD;
  v_reservation_id UUID;
  v_price_cents INTEGER;
  v_seat_count INTEGER;
  v_total INTEGER;
BEGIN
  SELECT *
  INTO v_hold
  FROM seat_holds
  WHERE id = p_hold_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'HOLD_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_hold.user_id <> p_user_id THEN
    RAISE EXCEPTION 'HOLD_FORBIDDEN' USING ERRCODE = 'P0003';
  END IF;

  IF v_hold.released_at IS NOT NULL OR v_hold.expires_at <= NOW() THEN
    RAISE EXCEPTION 'HOLD_EXPIRED' USING ERRCODE = 'P0004';
  END IF;

  IF EXISTS (SELECT 1 FROM reservations WHERE hold_id = p_hold_id) THEN
    RAISE EXCEPTION 'HOLD_CONSUMED' USING ERRCODE = 'P0005';
  END IF;

  PERFORM 1
  FROM showtime_seats ss
  WHERE ss.hold_id = p_hold_id
  FOR UPDATE;

  SELECT COUNT(*)::int
  INTO v_seat_count
  FROM showtime_seats ss
  WHERE ss.hold_id = p_hold_id
    AND ss.status = 'held';

  IF v_seat_count = 0 THEN
    RAISE EXCEPTION 'HOLD_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT st.price_cents
  INTO v_price_cents
  FROM showtimes st
  WHERE st.id = v_hold.showtime_id;

  v_total := v_seat_count * v_price_cents;
  v_reservation_id := gen_random_uuid();

  INSERT INTO reservations (
    id,
    reference_code,
    user_id,
    showtime_id,
    hold_id,
    status,
    total_amount_cents,
    currency,
    idempotency_key,
    expires_at
  )
  VALUES (
    v_reservation_id,
    p_reference_code,
    p_user_id,
    v_hold.showtime_id,
    p_hold_id,
    'pending',
    v_total,
    'USD',
    p_idempotency_key,
    p_expires_at
  );

  INSERT INTO reservation_seats (reservation_id, showtime_seat_id)
  SELECT v_reservation_id, ss.id
  FROM showtime_seats ss
  WHERE ss.hold_id = p_hold_id;

  UPDATE showtime_seats ss
  SET
    reservation_id = v_reservation_id,
    updated_at = NOW()
  WHERE ss.hold_id = p_hold_id;

  RETURN v_reservation_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_cancel_reservation(
  p_reservation_id UUID,
  p_user_id UUID
) RETURNS INTEGER[] AS $$
DECLARE
  v_reservation RECORD;
  v_seat_ids INTEGER[];
BEGIN
  SELECT r.id, r.user_id, r.status, r.hold_id, st.start_time
  INTO v_reservation
  FROM reservations r
  INNER JOIN showtimes st ON st.id = r.showtime_id
  WHERE r.id = p_reservation_id
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESERVATION_NOT_FOUND' USING ERRCODE = 'P0006';
  END IF;

  IF v_reservation.user_id <> p_user_id THEN
    RAISE EXCEPTION 'RESERVATION_FORBIDDEN' USING ERRCODE = 'P0007';
  END IF;

  IF v_reservation.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'NOT_CANCELLABLE' USING ERRCODE = 'P0008';
  END IF;

  IF v_reservation.start_time <= NOW() THEN
    RAISE EXCEPTION 'NOT_CANCELLABLE' USING ERRCODE = 'P0008';
  END IF;

  UPDATE reservations
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    updated_at = NOW()
  WHERE id = p_reservation_id;

  WITH released AS (
    UPDATE showtime_seats ss
    SET
      status = 'available',
      hold_id = NULL,
      reservation_id = NULL,
      version = ss.version + 1,
      updated_at = NOW()
    WHERE ss.reservation_id = p_reservation_id
    RETURNING ss.seat_id
  )
  SELECT COALESCE(array_agg(seat_id ORDER BY seat_id), ARRAY[]::INTEGER[])
  INTO v_seat_ids
  FROM released;

  UPDATE seat_holds
  SET released_at = NOW()
  WHERE id = v_reservation.hold_id
    AND released_at IS NULL;

  RETURN v_seat_ids;
END;
$$ LANGUAGE plpgsql;

-- Must drop first: stub in 0002 returns INTEGER; Phase 06 returns TABLE.
DROP FUNCTION IF EXISTS fn_expire_pending_reservations();

CREATE OR REPLACE FUNCTION fn_expire_pending_reservations()
RETURNS TABLE(showtime_id UUID, seat_ids INTEGER[]) AS $$
DECLARE
  v_row RECORD;
  v_seat_ids INTEGER[];
BEGIN
  FOR v_row IN
    SELECT r.id AS reservation_id, r.hold_id, r.showtime_id
    FROM reservations r
    WHERE r.status = 'pending'
      AND r.expires_at IS NOT NULL
      AND r.expires_at <= NOW()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE reservations
    SET status = 'expired', updated_at = NOW()
    WHERE id = v_row.reservation_id;

    WITH released AS (
      UPDATE showtime_seats ss
      SET
        status = 'available',
        hold_id = NULL,
        reservation_id = NULL,
        version = ss.version + 1,
        updated_at = NOW()
      WHERE ss.reservation_id = v_row.reservation_id
        AND ss.status = 'held'
      RETURNING ss.seat_id
    )
    SELECT COALESCE(array_agg(seat_id ORDER BY seat_id), ARRAY[]::INTEGER[])
    INTO v_seat_ids
    FROM released;

    UPDATE seat_holds
    SET released_at = NOW()
    WHERE id = v_row.hold_id
      AND released_at IS NULL;

    IF v_seat_ids IS NOT NULL AND COALESCE(array_length(v_seat_ids, 1), 0) > 0 THEN
      showtime_id := v_row.showtime_id;
      seat_ids := v_seat_ids;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
