-- release 34 (additive): "Show the ask in my alerts" (OWNER_router_25; the CEO 1:52 PM CT 16 Nov 2026). member_asks.alert_words: 1 when the
-- person turned it on (off unless they do); then GET /v1/member/tasks/{id}/alert gives an ask's first line (at most 80 characters).
ALTER TABLE member_asks ADD COLUMN alert_words INTEGER;
