-- NEXUS v2: users + entries tables
-- Existing tables (workout_events, generic_events) are left untouched.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    entry_type TEXT NOT NULL,
    date DATE NOT NULL,
    exercise_key TEXT,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_entries_user_exercise ON entries(user_id, exercise_key);
CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(user_id, entry_type);
