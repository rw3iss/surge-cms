-- Accounts created with a single name (registration, admin-created users,
-- Patreon) stored it only in display_name, so the profile's First/Last name
-- fields opened empty under the person's own name. Fill them from the display
-- name — first word, then the rest — for rows that have neither yet. Rows
-- where either was set by the person are left alone.
UPDATE users
   SET first_name = split_part(btrim(display_name), ' ', 1),
       last_name  = NULLIF(btrim(substr(btrim(display_name), length(split_part(btrim(display_name), ' ', 1)) + 1)), '')
 WHERE (first_name IS NULL OR first_name = '')
   AND (last_name IS NULL OR last_name = '')
   AND display_name IS NOT NULL
   AND btrim(display_name) <> '';
