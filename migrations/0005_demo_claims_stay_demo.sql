-- Demo claims stay demo. A demo claim uses a reserved @example.com email, and since 11 November 2026
-- anyone can sign in as the demo admin and approve one. So, enforced here as well as in the code:
--
--   1. An approved demo claim gets a demo-alumni- ID, never personal-. personal- IDs are only for
--      alumni the Alumni Association has really checked, and a demo admin can turn demo- profiles off.
--   2. A demo claim doesn't hold its student ID, so it can't block the real alumni from registering.
--
-- SQLite can't change a CHECK constraint, so both tables are rebuilt. The old ones are renamed first,
-- because dropping a parent table would cascade-delete the sign-in codes.

PRAGMA defer_foreign_keys = true;

-- Renaming also points alumni_sign_in_codes' foreign key at alumni_verifications_old.
ALTER TABLE alumni_verifications RENAME TO alumni_verifications_old;

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
  identity_user_id TEXT UNIQUE,
  review_note      TEXT CHECK (length(review_note) <= 500),
  reviewed_by      TEXT,
  reviewed_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT approved_has_identity CHECK ((status = 'approved') = (identity_user_id IS NOT NULL)),
  -- A demo claim's ID is a demo ID, and only a real claim's is personal-.
  CONSTRAINT identity_in_its_namespace CHECK (
    identity_user_id IS NULL
    OR (substr(email, -12) = '@example.com' AND substr(identity_user_id, 1, 12) = 'demo-alumni-')
    OR (substr(email, -12) <> '@example.com' AND substr(identity_user_id, 1, 9) = 'personal-')
  )
);

-- An approved demo claim from before this migration had a personal- ID: move it, and its profile, to
-- the demo namespace. The live database had none.
INSERT INTO alumni_verifications
  (id, email, display_name, student_id, faculty_id, grad_year, status, identity_user_id,
   review_note, reviewed_by, reviewed_at, created_at)
SELECT id, email, display_name, student_id, faculty_id, grad_year, status,
       CASE WHEN substr(email, -12) = '@example.com' AND identity_user_id IS NOT NULL
            THEN 'demo-alumni-' || substr(identity_user_id, 10)
            ELSE identity_user_id END,
       review_note, reviewed_by, reviewed_at, created_at
FROM alumni_verifications_old;

UPDATE alumni_profiles
SET identity_user_id = 'demo-alumni-' || substr(identity_user_id, 10)
WHERE identity_user_id IN (
  SELECT identity_user_id FROM alumni_verifications_old
  WHERE substr(email, -12) = '@example.com' AND identity_user_id IS NOT NULL
);

ALTER TABLE alumni_sign_in_codes RENAME TO alumni_sign_in_codes_old;

-- Single-use sign-in codes, the "link in your inbox". Only a SHA-256 hash is stored.
CREATE TABLE alumni_sign_in_codes (
  code_hash       TEXT PRIMARY KEY,
  verification_id TEXT NOT NULL REFERENCES alumni_verifications(id) ON DELETE CASCADE,
  expires_at      TEXT NOT NULL,
  used_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO alumni_sign_in_codes (code_hash, verification_id, expires_at, used_at, created_at)
SELECT code_hash, verification_id, expires_at, used_at, created_at FROM alumni_sign_in_codes_old;

DROP TABLE alumni_sign_in_codes_old;
DROP TABLE alumni_verifications_old;

-- One open or approved claim per email. One per student ID too, but demo claims don't count, so a
-- made-up claim can't hold a real student's ID. A rejected claim can be sent again.
CREATE UNIQUE INDEX alumni_verifications_live_email
  ON alumni_verifications (email) WHERE status IN ('pending', 'approved');
CREATE UNIQUE INDEX alumni_verifications_live_student
  ON alumni_verifications (student_id)
  WHERE status IN ('pending', 'approved') AND substr(email, -12) <> '@example.com';
CREATE INDEX alumni_verifications_by_status ON alumni_verifications (status, created_at);
