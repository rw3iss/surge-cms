-- "Show photo credits": print "Captured by <credits>" at the right of the post
-- header's author/date row when the banner's media item has credits.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS show_photo_credits BOOLEAN NOT NULL DEFAULT false;
