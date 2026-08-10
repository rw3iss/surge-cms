-- Generic entity system: mark a field as `filterable` so selection UIs (entity
-- search modals, the Data tab) offer a dropdown of its distinct/enum values to
-- filter results by. Core infrastructure (not feature-gated) — always installed.
-- `enum` label/value pairs ride in the existing `options` JSONB (options.enumOptions).

ALTER TABLE entity_fields
    ADD COLUMN IF NOT EXISTS filterable BOOLEAN NOT NULL DEFAULT false;
