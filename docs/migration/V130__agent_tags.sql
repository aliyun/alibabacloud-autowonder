-- Digital worker tags (system + custom). Apply before deploying the tag endpoints:
-- GET /api/agents and GET /api/agents/{id} read this table for every worker.
-- CREATE TABLE IF NOT EXISTS keeps the migration repeatable; removing a tag deletes its row.
CREATE TABLE IF NOT EXISTS `asset_tag` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT UNSIGNED NOT NULL,
  `asset_type`  VARCHAR(32)     NOT NULL DEFAULT 'AGENT' COMMENT '资产类型：AGENT；未来可扩展 MEMORY 等',
  `asset_id`    BIGINT UNSIGNED NOT NULL COMMENT '资产 id，AGENT 对应 agent.id',
  `tag_type`    VARCHAR(16)     NOT NULL COMMENT 'SYSTEM / CUSTOM',
  `tag_code`    VARCHAR(64)     DEFAULT NULL COMMENT '系统标签稳定 code；自定义标签为 NULL',
  `tag_name`    VARCHAR(64) COLLATE utf8mb4_bin NOT NULL COMMENT '系统标签存 code，自定义标签存用户输入文本',
  `gmt_create`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `creator_id`  BIGINT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_asset_tag` (`tenant_id`, `asset_type`, `asset_id`, `tag_type`, `tag_name`),
  KEY `idx_tenant_asset` (`tenant_id`, `asset_type`, `asset_id`),
  KEY `idx_tenant_type_name` (`tenant_id`, `asset_type`, `tag_type`, `tag_name`)
) ENGINE=InnoDB AUTO_INCREMENT=10000 DEFAULT CHARSET=utf8mb4 COMMENT='资产标签（数字人系统标签与自定义标签）';
