-- the stored-events counter can never go below zero and only these trigger functions (run as the table owner)
-- change it. The application role's right to update the users table is narrowed to its own columns by the roles
-- step, see app/db.py
ALTER TABLE users ADD CONSTRAINT users_stored_events_floor CHECK (stored_events >= 0);

CREATE OR REPLACE FUNCTION melophos_session_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    who uuid;
    delta bigint;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT owner_id INTO who FROM devices WHERE id = NEW.device_id;
        delta := NEW.event_count;
    ELSIF TG_OP = 'UPDATE' THEN
        SELECT owner_id INTO who FROM devices WHERE id = NEW.device_id;
        delta := NEW.event_count - OLD.event_count;
    ELSE
        SELECT owner_id INTO who FROM devices WHERE id = OLD.device_id;
        delta := -OLD.event_count;
    END IF;
    IF who IS NOT NULL AND delta <> 0 THEN
        UPDATE users SET stored_events = GREATEST(0, stored_events + delta) WHERE id = who;
    END IF;
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION melophos_device_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    IF OLD.owner_id IS NOT NULL THEN
        UPDATE users SET stored_events = GREATEST(0, stored_events
            - coalesce((SELECT sum(event_count) FROM practice_sessions WHERE device_id = OLD.id), 0))
            WHERE id = OLD.owner_id;
    END IF;
    RETURN OLD;
END $$;
