-- Update current personnel ranks; sealed operation snapshots remain historical.
UPDATE personnel SET rank = 'Guardsman' WHERE rank = 'Trooper';
