-- Ship a default "Mobile" breakpoint (max-width 768px) so the responsive
-- breakpoint feature is usable out of the box.
--
-- Backfills only installs whose `site_appearance` predates breakpoints (key
-- absent, not an array, or an empty list); installs that already defined their
-- own breakpoints are left untouched. Fresh installs with NO site_appearance
-- row get the same default via the keyed-setting fallback in services/settings.ts.

UPDATE site_settings
SET value = jsonb_set(
        value,
        '{breakpoints}',
        '[{"id":"mobile","name":"Mobile","maxWidth":"768"}]'::jsonb
    )
WHERE key = 'site_appearance'
  AND jsonb_array_length(
        CASE WHEN jsonb_typeof(value -> 'breakpoints') = 'array'
             THEN value -> 'breakpoints'
             ELSE '[]'::jsonb
        END
    ) = 0;
