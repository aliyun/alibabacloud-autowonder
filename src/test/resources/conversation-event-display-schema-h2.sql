-- H2 版会话执行详情派生表建表语句，镜像 docs/migration/V114 的列与唯一键，
-- 仅用于真实 DAO + 本地数据库的分页/大事件回归测试。
CREATE TABLE IF NOT EXISTS agent_conversation_turn_event (
    id BIGINT NOT NULL AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    conversation_id BIGINT NOT NULL,
    turn_id BIGINT NOT NULL,
    dispatch_attempt INT NOT NULL,
    event_seq BIGINT NOT NULL,
    chunk_index INT NOT NULL DEFAULT 0,
    chunk_count INT NOT NULL DEFAULT 1,
    event_type VARCHAR(32) NOT NULL,
    payload_fragment VARCHAR(1000000) NOT NULL,
    gmt_create TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_turn_event_chunk UNIQUE (tenant_id, turn_id, dispatch_attempt, event_seq, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_turn_event_page
    ON agent_conversation_turn_event (tenant_id, conversation_id, turn_id, id);

CREATE TABLE IF NOT EXISTS conversation_event_display (
    id BIGINT NOT NULL AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    conversation_id BIGINT NOT NULL,
    turn_id BIGINT NOT NULL,
    dispatch_attempt INT NOT NULL,
    event_seq BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    queue_class VARCHAR(16) NOT NULL DEFAULT 'REALTIME',
    projection_version VARCHAR(32) NOT NULL,
    publication_seq BIGINT DEFAULT NULL,
    summary VARCHAR(4096) DEFAULT NULL,
    content_length BIGINT DEFAULT NULL,
    total_segments INT DEFAULT NULL,
    truncated TINYINT NOT NULL DEFAULT 0,
    detail_available TINYINT NOT NULL DEFAULT 0,
    attempt_count INT NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP DEFAULT NULL,
    lease_owner VARCHAR(64) DEFAULT NULL,
    lease_until TIMESTAMP DEFAULT NULL,
    failure_reason VARCHAR(255) DEFAULT NULL,
    source_removed TINYINT NOT NULL DEFAULT 0,
    gmt_create TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_display_logical UNIQUE (tenant_id, conversation_id, turn_id, dispatch_attempt, event_seq)
);

CREATE INDEX IF NOT EXISTS idx_display_publish
    ON conversation_event_display (tenant_id, conversation_id, turn_id, status, publication_seq);

CREATE INDEX IF NOT EXISTS idx_display_claim_class
    ON conversation_event_display (status, queue_class, turn_id, id);

CREATE INDEX IF NOT EXISTS idx_display_turn_class
    ON conversation_event_display (tenant_id, conversation_id, turn_id, status, queue_class);

CREATE TABLE IF NOT EXISTS conversation_event_display_scan (
    scan_key VARCHAR(32) NOT NULL,
    last_raw_id BIGINT NOT NULL DEFAULT 0,
    high_water_raw_id BIGINT NOT NULL DEFAULT 0,
    generation BIGINT NOT NULL DEFAULT 0,
    quiet_until TIMESTAMP DEFAULT NULL,
    gmt_modified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scan_key)
);

CREATE TABLE IF NOT EXISTS conversation_event_content_segment (
    id BIGINT NOT NULL AUTO_INCREMENT,
    display_id BIGINT NOT NULL,
    projection_version VARCHAR(32) NOT NULL,
    segment_index INT NOT NULL,
    content VARCHAR(1000000) NOT NULL,
    content_bytes INT NOT NULL,
    gmt_create TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_segment UNIQUE (display_id, projection_version, segment_index)
);
