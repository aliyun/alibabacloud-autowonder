CREATE TABLE IF NOT EXISTS workitem_activity_launch (
    workspace_id BIGINT NOT NULL,
    workitem_id BIGINT NOT NULL,
    conversation_id BIGINT NOT NULL,
    activity VARCHAR(16) NOT NULL,
    squad_id BIGINT NOT NULL,
    agent_id BIGINT NOT NULL,
    repo_id BIGINT,
    creator_id BIGINT NOT NULL,
    phase VARCHAR(24) NOT NULL,
    attempt INT NOT NULL DEFAULT 1,
    next_check DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (workspace_id, conversation_id),
    KEY idx_launch_workitem (workspace_id, workitem_id, activity),
    KEY idx_launch_due (phase, next_check)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
