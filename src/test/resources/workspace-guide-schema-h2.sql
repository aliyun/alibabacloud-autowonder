-- H2 版新空间引导进度表，镜像 docs/migration/V108__workspace_guide_progress.sql 的列与唯一键
-- （uk_workspace_guide / idx_workspace_guide_user）；用 BIGINT 代替 BIGINT UNSIGNED、
-- TIMESTAMP 代替 DATETIME(3)，省略 ENGINE/CHARSET/COMMENT，仅用于 DAO 层回归测试。
CREATE TABLE IF NOT EXISTS workspace_guide_progress (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    workspace_id      BIGINT       NOT NULL,
    user_id           BIGINT       NOT NULL,
    status            VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    stage             TINYINT      NOT NULL DEFAULT 1,
    substep           TINYINT      NOT NULL DEFAULT 0,
    conversation_id   BIGINT       DEFAULT NULL,
    client_message_id VARCHAR(64)  DEFAULT NULL,
    version           INT          NOT NULL DEFAULT 0,
    gmt_create        TIMESTAMP    DEFAULT NULL,
    gmt_modified      TIMESTAMP    DEFAULT NULL,
    creator_id        BIGINT       DEFAULT NULL,
    modifier_id       BIGINT       DEFAULT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_workspace_guide UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_guide_user ON workspace_guide_progress (user_id);
