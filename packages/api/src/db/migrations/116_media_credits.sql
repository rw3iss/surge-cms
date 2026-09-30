-- Media credits (photographer / source / licence line), shown wherever a
-- template asks for it, e.g. {{post.featuredImage.credits}}.
ALTER TABLE media ADD COLUMN IF NOT EXISTS credits TEXT;
