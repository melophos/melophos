-- Issue 28: session webhooks with a queue, so sending never happens inside the request that caused it.

-- owner_id is null for the one operator endpoint set by SESSION_WEBHOOK_URL, which receives every session
CREATE TABLE webhook_endpoints (
    id                   uuid PRIMARY KEY,
    owner_id             uuid REFERENCES users (id) ON DELETE CASCADE,
    url                  text NOT NULL,
    secret_enc           bytea NOT NULL,
    enabled              boolean NOT NULL DEFAULT true,
    consecutive_failures integer NOT NULL DEFAULT 0,
    disabled_at          timestamptz,
    disabled_reason      text,
    last_success_at      timestamptz,
    last_failure_at      timestamptz,
    last_status          integer,
    last_error           text,
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_endpoints_owner ON webhook_endpoints (owner_id);
CREATE UNIQUE INDEX webhook_endpoints_operator ON webhook_endpoints ((true)) WHERE owner_id IS NULL;

CREATE TABLE webhook_deliveries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id     uuid NOT NULL REFERENCES webhook_endpoints (id) ON DELETE CASCADE,
    session_id      uuid NOT NULL,
    payload         jsonb NOT NULL,
    state           text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'delivered', 'failed', 'cancelled')),
    attempts        integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_status     integer,
    last_error      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    delivered_at    timestamptz,
    UNIQUE (endpoint_id, session_id)
);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries (next_attempt_at) WHERE state = 'pending';
CREATE INDEX webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id, created_at DESC);
