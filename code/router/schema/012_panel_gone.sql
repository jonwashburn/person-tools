-- release 12 (additive): policy/OWN_PANELS.md rule 10. When a principal's own panels go (its account deleted, or 30 days
-- idle for a test principal), each member is switched Off and left, and told once, in one line, that the panel is gone;
-- the line is cleared when shown, and the member row itself goes a day later (retention step 6).
ALTER TABLE members ADD COLUMN gone_note TEXT;
