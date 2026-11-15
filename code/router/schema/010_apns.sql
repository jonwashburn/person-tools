-- release 10 (additive): Apple push for the person's iPhone app (the owner, 10:44 PM CT 14 Nov 2026). One device token per
-- member (the latest the app gave), and whether it is a development (sandbox) or App Store (production) build. Cleared when
-- the person leaves, when Apple says the token is dead, or when the same phone joins as another member.
ALTER TABLE members ADD COLUMN apns_token TEXT;
ALTER TABLE members ADD COLUMN apns_env TEXT;
CREATE INDEX IF NOT EXISTS members_apns_token ON members(apns_token);
