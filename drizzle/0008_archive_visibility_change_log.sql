ALTER TABLE operation_audits ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
CREATE TABLE change_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, actor TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', ip TEXT NOT NULL DEFAULT '', machine_id TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);
CREATE INDEX change_log_ip ON change_log(ip);
CREATE INDEX change_log_machine ON change_log(machine_id);
