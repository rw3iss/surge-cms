-- Add the `forum` content block (an in-page forum / live discussion widget) to
-- both block enums.
--
-- Core (not feature-tagged): the enum is shared by every block table, and a
-- forum block saved while the feature is off must still be storable (it then
-- renders nothing).
ALTER TYPE block_type ADD VALUE IF NOT EXISTS 'forum';
ALTER TYPE content_block_type ADD VALUE IF NOT EXISTS 'forum';
