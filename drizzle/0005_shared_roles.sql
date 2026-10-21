-- Keep the existing Section Leader key; adopt SPEAR 2's key only if none exists.
INSERT OR IGNORE INTO settings(key,value) SELECT 'phrase_ic',value FROM settings WHERE key='phrase_ic2';
DELETE FROM settings WHERE key='phrase_ic2';
UPDATE personnel SET rank='Guardsman' WHERE rank='Veteran';
