-- Phase 07: Stripe payment confirm/fail functions and webhook event dedup

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION fn_confirm_reservation(
  p_reservation_id UUID,
  p_payment_intent_id TEXT
) RETURNS VOID AS $$
DECLARE
  v_status reservation_status;
BEGIN
  SELECT status
  INTO v_status
  FROM reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESERVATION_NOT_FOUND' USING ERRCODE = 'P0006';
  END IF;

  IF v_status = 'confirmed' THEN
    RETURN;
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'NOT_CONFIRMABLE' USING ERRCODE = 'P0009';
  END IF;

  UPDATE reservations
  SET
    status = 'confirmed',
    confirmed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_reservation_id;

  UPDATE showtime_seats ss
  SET
    status = 'reserved',
    updated_at = NOW()
  WHERE ss.reservation_id = p_reservation_id
    AND ss.status = 'held';

  IF NOT EXISTS (SELECT 1 FROM payments WHERE reservation_id = p_reservation_id) THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND' USING ERRCODE = 'P0010';
  END IF;

  UPDATE payments
  SET
    status = 'completed',
    provider_payment_intent_id = p_payment_intent_id,
    updated_at = NOW()
  WHERE reservation_id = p_reservation_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_fail_payment(
  p_reservation_id UUID
) RETURNS INTEGER[] AS $$
DECLARE
  v_reservation RECORD;
  v_seat_ids INTEGER[];
BEGIN
  SELECT r.id, r.status, r.hold_id, r.showtime_id
  INTO v_reservation
  FROM reservations r
  WHERE r.id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESERVATION_NOT_FOUND' USING ERRCODE = 'P0006';
  END IF;

  IF v_reservation.status = 'confirmed' THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  IF v_reservation.status = 'pending' THEN
    UPDATE reservations
    SET
      status = 'expired',
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
        AND ss.status = 'held'
      RETURNING ss.seat_id
    )
    SELECT COALESCE(array_agg(seat_id ORDER BY seat_id), ARRAY[]::INTEGER[])
    INTO v_seat_ids
    FROM released;

    UPDATE payments
    SET
      status = 'failed',
      updated_at = NOW()
    WHERE reservation_id = p_reservation_id;

    UPDATE seat_holds
    SET released_at = NOW()
    WHERE id = v_reservation.hold_id
      AND released_at IS NULL;
  ELSE
    v_seat_ids := ARRAY[]::INTEGER[];
  END IF;

  RETURN v_seat_ids;
END;
$$ LANGUAGE plpgsql;
