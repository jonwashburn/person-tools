-- release 20 (additive): a connection may be limited to some urgencies (operations 12:25 PM CT 15 Nov 2026): a JSON list of
-- "now", "today", "whenever"; empty means all three. An ask outside them is refused (422) with the allowed list.
ALTER TABLE connections ADD COLUMN urgencies TEXT;
