CREATE TABLE assignment_role_memory (
 operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
 slot TEXT NOT NULL,
 PRIMARY KEY(operation_id,user_id),
 UNIQUE(operation_id,slot)
);
