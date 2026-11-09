CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- A partner retrying a webhook delivery must not create a duplicate row.
CREATE UNIQUE INDEX idx_webhook_events_source_id ON webhook_events (source_id);

CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
