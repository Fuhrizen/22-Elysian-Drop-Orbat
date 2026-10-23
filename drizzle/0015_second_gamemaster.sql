-- Extend saved live layouts without touching signups or sealed operation snapshots.
-- Unsaved layouts use defaultLayout(), which already includes the second command slot.
UPDATE settings
SET value = json_set(
    value,
    '$.revision', COALESCE(json_extract(value, '$.revision'), 0) + 1,
    '$.layout.slots', json_insert(json_extract(value, '$.layout.slots'), '$[#]',
        json_object('id', 'gm2', 'name', 'Gamemaster', 'code', 'CMD/02',
                    'protected', json('true'), 'type', 'command',
                    'section', 'command', 'phraseRole', 'gm'))
)
WHERE key = 'orbat_layout'
  AND json_valid(value)
  AND EXISTS (SELECT 1 FROM json_each(settings.value, '$.layout.sections')
              WHERE json_extract(json_each.value, '$.id') = 'command')
  AND EXISTS (SELECT 1 FROM json_each(settings.value, '$.layout.slots')
              WHERE json_extract(json_each.value, '$.id') = 'gm')
  AND NOT EXISTS (SELECT 1 FROM json_each(settings.value, '$.layout.slots')
                  WHERE json_extract(json_each.value, '$.id') = 'gm2');
