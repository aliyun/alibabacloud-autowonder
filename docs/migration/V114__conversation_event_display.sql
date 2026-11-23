-- Execution detail display index/task and public content segments.
-- Additive only: the raw event table and its retention are untouched.
CREATE TABLE IF NOT EXISTS conversation_event_display (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  turn_id BIGINT UNSIGNED NOT NULL,
  dispatch_attempt INT NOT NULL,
  event_seq BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  projection_version VARCHAR(32) NOT NULL,
  publication_seq BIGINT NULL,
  summary TEXT NULL,
  content_length BIGINT NULL,
  total_segments INT NULL,
  truncated TINYINT NOT NULL DEFAULT 0,
  detail_available TINYINT NOT NULL DEFAULT 0,
  attempt_count INT NOT NULL DEFAULT 0,
  next_retry_at DATETIME(3) NULL,
  lease_owner VARCHAR(64) NULL,
  lease_until DATETIME(3) NULL,
  failure_reason VARCHAR(255) NULL,
  source_removed TINYINT NOT NULL DEFAULT 0,
  gmt_create DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  gmt_modified DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_display_logical (tenant_id,conversation_id,turn_id,dispatch_attempt,event_seq),
  KEY idx_display_publish (tenant_id,conversation_id,turn_id,status,publication_seq),
  KEY idx_display_claim (status,next_retry_at,lease_until),
  KEY idx_display_cleanup (gmt_create)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS conversation_event_content_segment (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  display_id BIGINT UNSIGNED NOT NULL,
  projection_version VARCHAR(32) NOT NULL,
  segment_index INT NOT NULL,
  content MEDIUMTEXT NOT NULL,
  content_bytes INT NOT NULL,
  gmt_create DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_segment (display_id,projection_version,segment_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
