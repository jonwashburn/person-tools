-- release 36 (additive, an index only): the calls not yet closed, which settle() reads on every request (16 Nov, the slow API).
CREATE INDEX IF NOT EXISTS calls_unclosed ON calls(status, deadline_at) WHERE closed_at IS NULL;
