-- MFU Alumni Network schema, ported from Team19_Pod5_Data-and-Query-Design.md (Appendix A) to D1.
-- Table and column names match the PostgreSQL design. D1 has no enums, so status columns use CHECK.
-- alumni_events is new: the design has no table for inbound Events & Clubs events (PRD FR-11).

CREATE TABLE faculties (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 2 AND 100),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE interests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 2 AND 60),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE alumni_profiles (
  id                       TEXT PRIMARY KEY,
  -- NULLable on purpose: erasure clears it so the person can register again (BR-04).
  identity_user_id         TEXT UNIQUE,
  display_name             TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 100),
  grad_year                INTEGER NOT NULL CHECK (grad_year BETWEEN 1998 AND 2100),
  faculty_id               INTEGER NOT NULL REFERENCES faculties(id) ON DELETE RESTRICT,
  job_title                TEXT CHECK (length(job_title) <= 100),
  company                  TEXT CHECK (length(company) <= 100),
  country_code             TEXT CHECK (country_code GLOB '[A-Z][A-Z]'),
  city                     TEXT CHECK (length(city) <= 100),
  bio                      TEXT CHECK (length(bio) <= 1000),

  is_open_to_mentoring     INTEGER NOT NULL DEFAULT 0 CHECK (is_open_to_mentoring IN (0, 1)),
  mentee_capacity          INTEGER NOT NULL DEFAULT 3 CHECK (mentee_capacity BETWEEN 0 AND 10),

  -- Stored, but never returned unless the matching consent flag is on (BR-01).
  contact_email            TEXT CHECK (contact_email LIKE '%_@_%._%'),
  contact_line             TEXT CHECK (length(contact_line) <= 100),
  contact_linkedin         TEXT CHECK (length(contact_linkedin) <= 200),

  consent_contact_email    INTEGER NOT NULL DEFAULT 0 CHECK (consent_contact_email IN (0, 1)),
  consent_contact_line     INTEGER NOT NULL DEFAULT 0 CHECK (consent_contact_line IN (0, 1)),
  consent_contact_linkedin INTEGER NOT NULL DEFAULT 0 CHECK (consent_contact_linkedin IN (0, 1)),
  consent_timestamp        TEXT,
  consent_purpose_version  TEXT CHECK (length(consent_purpose_version) <= 20),

  is_active                INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- BR-02: consent cannot exist without a dated, versioned record.
  CONSTRAINT consent_requires_record CHECK (
    NOT (consent_contact_email OR consent_contact_line OR consent_contact_linkedin)
    OR (consent_timestamp IS NOT NULL AND consent_purpose_version IS NOT NULL)
  ),
  -- Nobody can consent to share a field that is empty.
  CONSTRAINT email_consent_needs_value    CHECK (NOT consent_contact_email    OR contact_email    IS NOT NULL),
  CONSTRAINT line_consent_needs_value     CHECK (NOT consent_contact_line     OR contact_line     IS NOT NULL),
  CONSTRAINT linkedin_consent_needs_value CHECK (NOT consent_contact_linkedin OR contact_linkedin IS NOT NULL)
);

CREATE INDEX alumni_profiles_search ON alumni_profiles (is_active, grad_year DESC);

CREATE TABLE alumni_interests (
  alumni_id   TEXT NOT NULL REFERENCES alumni_profiles(id) ON DELETE CASCADE,
  interest_id INTEGER NOT NULL REFERENCES interests(id) ON DELETE RESTRICT,
  PRIMARY KEY (alumni_id, interest_id)
);

-- Students exist only as Identity user IDs, so their interests are keyed by that ID.
CREATE TABLE student_interests (
  identity_user_id TEXT NOT NULL,
  interest_id      INTEGER NOT NULL REFERENCES interests(id) ON DELETE RESTRICT,
  PRIMARY KEY (identity_user_id, interest_id)
);

CREATE TABLE mentoring_requests (
  id           TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL,
  alumni_id    TEXT NOT NULL REFERENCES alumni_profiles(id) ON DELETE CASCADE,
  message      TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 10 AND 2000),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  responded_at TEXT,
  -- A pending request has no response time, and a closed one must.
  CONSTRAINT responded_at_matches_status CHECK (
    (status = 'pending' AND responded_at IS NULL) OR
    (status <> 'pending' AND responded_at IS NOT NULL)
  )
);

-- BR-05: at most one pending request per student and alumni pair, enforced by the database.
CREATE UNIQUE INDEX one_pending_request_per_pair
  ON mentoring_requests (student_id, alumni_id)
  WHERE status = 'pending';

CREATE INDEX mentoring_requests_by_student ON mentoring_requests (student_id, created_at DESC);
CREATE INDEX mentoring_requests_by_alumni  ON mentoring_requests (alumni_id, created_at DESC);

CREATE TABLE connections (
  id         TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES mentoring_requests(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL,
  alumni_id  TEXT NOT NULL REFERENCES alumni_profiles(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at   TEXT,
  CONSTRAINT ended_at_matches_status CHECK (
    (status = 'active' AND ended_at IS NULL) OR
    (status = 'ended' AND ended_at IS NOT NULL)
  )
);

-- Capacity counting reads this index on every accept.
CREATE INDEX connections_active_by_alumni ON connections (alumni_id) WHERE status = 'active';
CREATE INDEX connections_by_student       ON connections (student_id, status);

-- Events are written in the same transaction as the action that caused them, then delivered later.
CREATE TABLE webhook_outbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      TEXT NOT NULL UNIQUE,
  event_type    TEXT NOT NULL CHECK (length(event_type) <= 60),
  payload       TEXT NOT NULL CHECK (json_valid(payload)),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivering', 'delivered', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_retry_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  locked_at     TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX webhook_outbox_due   ON webhook_outbox (next_retry_at) WHERE status = 'pending';
CREATE INDEX webhook_outbox_stuck ON webhook_outbox (locked_at) WHERE status = 'delivering';

-- PDPA evidence (BR-10). The triggers below make it append-only.
CREATE TABLE contact_reveal_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
  viewer_id     TEXT NOT NULL,
  field_name    TEXT NOT NULL CHECK (field_name IN ('contact_email', 'contact_line', 'contact_linkedin')),
  revealed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX contact_reveal_log_by_connection ON contact_reveal_log (connection_id);

-- Alumni events received from Events & Clubs. event_id is UNIQUE so a retried delivery stores once.
CREATE TABLE alumni_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT NOT NULL UNIQUE,
  event_type  TEXT NOT NULL,
  title       TEXT NOT NULL,
  starts_at   TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload     TEXT NOT NULL CHECK (json_valid(payload)),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER alumni_profiles_set_updated_at
  AFTER UPDATE ON alumni_profiles
  FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE alumni_profiles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER contact_reveal_log_no_update
  BEFORE UPDATE ON contact_reveal_log
BEGIN
  SELECT RAISE(ABORT, 'APPEND_ONLY: contact_reveal_log rows cannot be modified');
END;

CREATE TRIGGER contact_reveal_log_no_delete
  BEFORE DELETE ON contact_reveal_log
BEGIN
  SELECT RAISE(ABORT, 'APPEND_ONLY: contact_reveal_log rows cannot be deleted');
END;

-- The design doc says to confirm this list against MFU's official directory before launch.
INSERT INTO faculties (name) VALUES
  ('School of Science'),
  ('School of Liberal Arts'),
  ('School of Management'),
  ('School of Law'),
  ('School of Medicine'),
  ('School of Agro-Industry'),
  ('School of Information Technology'),
  ('School of Cosmetic Science'),
  ('School of Health Science'),
  ('School of Nursing'),
  ('School of Anti-Aging and Regenerative Medicine');

INSERT INTO interests (name) VALUES
  ('Software Development'), ('Data & AI'), ('Cybersecurity'), ('UX/UI Design'),
  ('Product Management'), ('Entrepreneurship'), ('Marketing'), ('Finance'),
  ('Hospitality & Tourism'), ('Healthcare'), ('Nursing Practice'), ('Law & Compliance'),
  ('Cosmetic Science'), ('Food Technology'), ('Teaching & Academia'),
  ('Studying Abroad'), ('Working Abroad');
