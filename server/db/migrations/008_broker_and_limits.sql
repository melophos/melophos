-- a hub gets a broker login only after an account has claimed it.
ALTER TABLE devices ADD COLUMN broker_ready boolean NOT NULL DEFAULT false;
-- the hubs paired before this migration already have a login, so they are marked ready
UPDATE devices SET broker_ready = true WHERE owner_id IS NOT NULL;

-- a counted event can be taken back (a reserved place is released when the attempt succeeds)
ALTER TABLE rate_events ADD COLUMN id bigserial;
CREATE INDEX rate_events_id ON rate_events (id);

-- who asked for a pairing code, so one address cannot hold more than its share of the waiting codes
ALTER TABLE pairing_codes ADD COLUMN requester text;
CREATE INDEX pairing_codes_requester ON pairing_codes (requester, created_at);
