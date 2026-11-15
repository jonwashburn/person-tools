-- release 21 (additive): notes on a task (operations 1:00 PM CT 15 Nov 2026: a note on any card, and a note that keeps the ask
-- open). tasks.notes_json: [{at, note, by: "person" | "asker"}] in order; a note leaves the task open and is
-- not an answer.
ALTER TABLE tasks ADD COLUMN notes_json TEXT;
