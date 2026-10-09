-- Add provenance without relabelling historical records as the new provider.
ALTER TABLE search_results ADD COLUMN provider TEXT NOT NULL DEFAULT 'legacy_search';
ALTER TABLE search_results ADD COLUMN original_url TEXT;
ALTER TABLE search_results ADD COLUMN source_domain TEXT;
ALTER TABLE search_results ADD COLUMN provider_metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE search_results ADD COLUMN extracted_content TEXT;
ALTER TABLE usage ADD COLUMN operation TEXT NOT NULL DEFAULT 'search';
ALTER TABLE usage ADD COLUMN credits_used REAL;
CREATE TABLE provider_health(provider TEXT PRIMARY KEY,blocked_until TEXT,block_reason TEXT,last_success_at TEXT,last_request_at TEXT,last_outcome TEXT);
CREATE TABLE extraction_jobs(id INTEGER PRIMARY KEY,url TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'Manual URL',status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,run_at TEXT NOT NULL,created_at TEXT NOT NULL,finished_at TEXT,error TEXT,result TEXT,observation_id INTEGER REFERENCES observations(id));
CREATE UNIQUE INDEX active_extraction_url ON extraction_jobs(url) WHERE status IN ('queued','running','retry');
-- Old cache keys have no provider namespace. Keep them for their original TTL;
-- the new adapter only reads firecrawl:v2:* keys.
DELETE FROM settings WHERE key='braveBlockedUntil';
