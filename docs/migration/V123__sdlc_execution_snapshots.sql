-- Additive analytical snapshots. Existing dispatches remain unknown until their task package is verified.
CREATE TABLE IF NOT EXISTS sdlc_execution_snapshot (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id BIGINT UNSIGNED NOT NULL,
    sdlc_id BIGINT UNSIGNED NOT NULL,
    content_hash CHAR(64) NOT NULL,
    configuration_json JSON NOT NULL,
    gmt_create DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_sdlc_snapshot (workspace_id, sdlc_id, content_hash)
) ENGINE=InnoDB AUTO_INCREMENT=10000 DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dispatch_sdlc_snapshot (
    workspace_id BIGINT UNSIGNED NOT NULL,
    dispatch_id BIGINT UNSIGNED NOT NULL,
    snapshot_id BIGINT UNSIGNED DEFAULT NULL,
    package_sha256 CHAR(64) DEFAULT NULL,
    source VARCHAR(24) NOT NULL,
    gmt_create DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (workspace_id, dispatch_id),
    KEY idx_snapshot_dispatch (workspace_id, snapshot_id, dispatch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
