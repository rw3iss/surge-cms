-- Add `template` to the block_type enum.
--
-- A `template` block references a reusable Component (a row in
-- content_block_templates with no entity_type_key) and renders its block subtree
-- in place — by reference, so editing the component updates every use.
--
-- ADD VALUE IF NOT EXISTS is idempotent, which matters because this runner
-- re-applies migrations on a fresh install and must reach the same schema.
ALTER TYPE block_type ADD VALUE IF NOT EXISTS 'template';
