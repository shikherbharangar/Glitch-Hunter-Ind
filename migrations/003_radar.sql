CREATE TABLE radar_cycles(category_id TEXT PRIMARY KEY, last_planned TEXT NOT NULL, round INTEGER NOT NULL DEFAULT 0);
CREATE TABLE radar_targets(url TEXT PRIMARY KEY, category TEXT NOT NULL, observation_id INTEGER REFERENCES observations(id), next_check TEXT NOT NULL, last_checked TEXT NOT NULL);
CREATE INDEX radar_due ON radar_targets(next_check);
