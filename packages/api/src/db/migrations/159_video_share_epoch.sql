-- @feature video

-- Revocable share links. A share token is a stateless HMAC; signing the
-- video's `share_epoch` into it lets an operator revoke every link of ONE
-- video ("Revoke share links" bumps the epoch) without rotating JWT_SECRET,
-- which would also sign every user out. An access-level change bumps it too.
-- Epoch 0 keeps the original token format, so links issued before this
-- migration stay valid until the first revoke.
ALTER TABLE media_videos ADD COLUMN IF NOT EXISTS share_epoch INTEGER NOT NULL DEFAULT 0;
