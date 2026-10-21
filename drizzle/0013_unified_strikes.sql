UPDATE personnel_warnings SET kind='strike' WHERE kind='warning';
ALTER TABLE personnel_warnings ADD COLUMN removed_at TEXT;
