-- Password auth for studio and acquisition logins (replacing magic links).
-- Operators already authenticate with email + password (operator_user.password_hash).
-- The studio's primary contact logs in via studio.password_hash; additional
-- studio login users via studio_contact.password_hash; acquisition members via
-- acquisition_user.password_hash. Email remains the login identifier.
ALTER TABLE studio ADD COLUMN password_hash TEXT;
ALTER TABLE studio_contact ADD COLUMN password_hash TEXT;
ALTER TABLE acquisition_user ADD COLUMN password_hash TEXT;
