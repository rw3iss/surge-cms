-- Migration 026: Add parent_block_id to blocks for recursive composition.
--
-- Top-level blocks have parent_block_id = NULL. ON DELETE CASCADE removes
-- subtrees when a parent is deleted. Position ordering becomes per-parent;
-- uniqueness within (page_id, parent_block_id) is enforced in app code.
--
-- Adds two new block types: 'group' (container) and 'group_item' (slot
-- wrapper). group_item is the only valid direct child of a group.

ALTER TABLE blocks
    ADD COLUMN parent_block_id UUID REFERENCES blocks(id) ON DELETE CASCADE;

CREATE INDEX idx_blocks_parent_order ON blocks(parent_block_id, "order");

ALTER TYPE block_type ADD VALUE IF NOT EXISTS 'group';
ALTER TYPE block_type ADD VALUE IF NOT EXISTS 'group_item';
