CREATE TABLE IF NOT EXISTS prd_review_share (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  workitem_id BIGINT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  source_key VARCHAR(128) NOT NULL,
  token VARCHAR(64) NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  version INT NOT NULL DEFAULT 1,
  creator_id BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uk_review_share_scope(workspace_id,conversation_id,source_key),
  UNIQUE KEY uk_review_share_token(token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prd_review_preview_grant (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  kind VARCHAR(16) NOT NULL,
  share_id BIGINT UNSIGNED NOT NULL,
  share_version INT NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  binding_id VARCHAR(100) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed TINYINT NOT NULL DEFAULT 0,
  KEY idx_preview_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prd_review_tunnel (
  workspace_id BIGINT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  executor_id BIGINT UNSIGNED NOT NULL,
  turn_id BIGINT UNSIGNED NOT NULL,
  dispatch_attempt INT NOT NULL,
  report_sequence INT NOT NULL,
  binding_id VARCHAR(100) NOT NULL,
  status VARCHAR(16) NOT NULL,
  PRIMARY KEY(workspace_id,conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prd_review_comment (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  workitem_id BIGINT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  source_key VARCHAR(128) NOT NULL,
  runtime_revision BIGINT NOT NULL,
  route_path VARCHAR(2048) NOT NULL,
  selector VARCHAR(1000) NOT NULL,
  element_json TEXT NOT NULL,
  comment_text TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  creator_id BIGINT UNSIGNED NOT NULL,
  client_id VARCHAR(100) NOT NULL,
  version INT NOT NULL DEFAULT 0,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  last_sent_turn_id BIGINT UNSIGNED DEFAULT NULL,
  gmt_create DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  gmt_modified DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_review_comment_replay(workspace_id,conversation_id,source_key,creator_id,client_id),
  KEY idx_review_comments(workspace_id,workitem_id,conversation_id,is_deleted,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
