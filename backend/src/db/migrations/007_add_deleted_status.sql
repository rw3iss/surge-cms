-- Add 'deleted' to page_status and post_status enums
ALTER TYPE page_status ADD VALUE IF NOT EXISTS 'deleted';
ALTER TYPE post_status ADD VALUE IF NOT EXISTS 'deleted';
