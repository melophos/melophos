-- addresses an account has signed in from, so spraying from an address cannot block people already known to it
CREATE TABLE known_addresses (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    addr    text NOT NULL,
    last_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, addr)
);
CREATE INDEX known_addresses_last ON known_addresses (last_at);

-- a webhook delivery belongs to a session, so it goes when the session goes (and with the account that owned it)
DELETE FROM webhook_deliveries d WHERE NOT EXISTS (SELECT 1 FROM practice_sessions s WHERE s.id = d.session_id);
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_session
    FOREIGN KEY (session_id) REFERENCES practice_sessions (id) ON DELETE CASCADE;

-- a running total of stored note events per account, kept by triggers, so a message does not sum every session
ALTER TABLE users ADD COLUMN stored_events bigint NOT NULL DEFAULT 0;
UPDATE users u SET stored_events = coalesce(
    (SELECT sum(s.event_count) FROM practice_sessions s JOIN devices d ON d.id = s.device_id WHERE d.owner_id = u.id), 0);

CREATE FUNCTION melophos_session_events() RETURNS trigger LANGUAGE plpgsql AS $$
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
        UPDATE users SET stored_events = stored_events + delta WHERE id = who;
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER practice_sessions_events AFTER INSERT OR UPDATE OF event_count OR DELETE ON practice_sessions
    FOR EACH ROW EXECUTE FUNCTION melophos_session_events();

-- removing a device removes its sessions through a cascade that can no longer find the owner, so take them off first
CREATE FUNCTION melophos_device_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.owner_id IS NOT NULL THEN
        UPDATE users SET stored_events = stored_events
            - coalesce((SELECT sum(event_count) FROM practice_sessions WHERE device_id = OLD.id), 0)
            WHERE id = OLD.owner_id;
    END IF;
    RETURN OLD;
END $$;
CREATE TRIGGER devices_events BEFORE DELETE ON devices FOR EACH ROW EXECUTE FUNCTION melophos_device_events();
