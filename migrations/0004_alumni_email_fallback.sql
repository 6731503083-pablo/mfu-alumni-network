-- PRD Assumption 1 fallback: alumni whose student email has closed sign up with a personal email,
-- and the Alumni Association checks the claim before they can sign in.

CREATE TABLE alumni_verifications (
  id               TEXT PRIMARY KEY,
  -- Stored lowercased. Student addresses close after graduation, so they're refused.
  email            TEXT NOT NULL CHECK (email LIKE '%_@_%._%' AND email NOT LIKE '%@lamduan.mfu.ac.th'),
  display_name     TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 100),
  -- What the Association checks against graduation records.
  student_id       TEXT NOT NULL CHECK (length(student_id) = 10 AND student_id NOT GLOB '*[^0-9]*'),
  faculty_id       INTEGER NOT NULL REFERENCES faculties(id) ON DELETE RESTRICT,
  grad_year        INTEGER NOT NULL CHECK (grad_year BETWEEN 1998 AND 2100),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Set on approval. Its own prefix, so it can't collide with an Identity service user ID.
  identity_user_id TEXT UNIQUE CHECK (identity_user_id IS NULL OR identity_user_id LIKE 'personal-%'),
  review_note      TEXT CHECK (length(review_note) <= 500),
  reviewed_by      TEXT,
  reviewed_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT approved_has_identity CHECK ((status = 'approved') = (identity_user_id IS NOT NULL))
);

-- One open or approved claim per email and per student ID. A rejected claim can be sent again.
CREATE UNIQUE INDEX alumni_verifications_live_email
  ON alumni_verifications (email) WHERE status IN ('pending', 'approved');
CREATE UNIQUE INDEX alumni_verifications_live_student
  ON alumni_verifications (student_id) WHERE status IN ('pending', 'approved');
CREATE INDEX alumni_verifications_by_status ON alumni_verifications (status, created_at);

-- Single-use sign-in codes, the "link in your inbox". Only a SHA-256 hash is stored.
CREATE TABLE alumni_sign_in_codes (
  code_hash       TEXT PRIMARY KEY,
  verification_id TEXT NOT NULL REFERENCES alumni_verifications(id) ON DELETE CASCADE,
  expires_at      TEXT NOT NULL,
  used_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
