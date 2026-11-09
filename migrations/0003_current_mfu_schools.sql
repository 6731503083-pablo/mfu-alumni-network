-- MFU's schools as its official directory lists them (https://schooldirectory.mfu.ac.th/, checked
-- 9 Nov 2026). The PRD's list of 11 was out of date: the School of Information Technology became the
-- School of Applied Digital Technology in academic year 2024, and four schools were missing.
-- IDs stay the same, so existing profiles keep their school.

UPDATE faculties SET name = 'School of Applied Digital Technology' WHERE id = 7;

INSERT INTO faculties (id, name) VALUES
  (12, 'School of Dentistry'),
  (13, 'School of Social Innovation'),
  (14, 'School of Sinology'),
  (15, 'School of Integrative Medicine');
