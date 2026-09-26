-- @feature shop
-- Per-line metadata on shop order items.
--
-- Event tickets are sold through the shop cart but are not catalogue
-- products: their line has no product/variant row, so what the order must
-- remember — which event, which date, which tier, and the attendee's details —
-- has nowhere else to live. Read at payment time to register the attendee and
-- issue the tickets.
ALTER TABLE shop_order_items ADD COLUMN IF NOT EXISTS metadata JSONB;
