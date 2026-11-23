-- PRD 实时预览与设计评审
-- 存量数据库执行本迁移。新建数据库使用 docs/autowonder-schema.sql。

CREATE TABLE IF NOT EXISTS `prd_design_runtime` (
  `workspace_id` BIGINT UNSIGNED NOT NULL COMMENT '工作空间 ID',
  `workitem_id` BIGINT UNSIGNED NOT NULL COMMENT '关联工单 ID',
  `conversation_id` BIGINT UNSIGNED NOT NULL COMMENT '设计会话 ID',
  `executor_id` BIGINT UNSIGNED NOT NULL COMMENT '运行预览的执行器 ID',
  `turn_id` BIGINT UNSIGNED NOT NULL COMMENT '本次上报所属的设计对话轮次 ID',
  `dispatch_attempt` INT NOT NULL COMMENT '轮次的派发尝试序号',
  `source_key` VARCHAR(128) NOT NULL COMMENT '设计源工程和目标配置的标识',
  `directory` VARCHAR(1024) NOT NULL COMMENT '执行器上的设计工程目录',
  `status` VARCHAR(16) NOT NULL DEFAULT 'STARTING' COMMENT '设计工程运行状态',
  `port` INT DEFAULT NULL COMMENT 'Vite 实际监听的端口',
  `route` VARCHAR(2048) NOT NULL DEFAULT '/' COMMENT '预览进入时的业务路由',
  `error` VARCHAR(2048) DEFAULT NULL COMMENT '设计工程运行失败原因',
  `revision` BIGINT NOT NULL DEFAULT 0 COMMENT '设计预览修订号',
  `report_sequence` INT NOT NULL DEFAULT 0 COMMENT '同一次派发尝试内的状态上报序号',
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '记录最近修改时间',
  PRIMARY KEY (`workspace_id`, `conversation_id`),
  KEY `idx_prd_runtime_workitem` (`workspace_id`, `workitem_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品与交互设计工程运行状态';

CREATE TABLE IF NOT EXISTS prd_review_share (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '分享记录 ID',
  workspace_id BIGINT UNSIGNED NOT NULL COMMENT '工作空间 ID',
  workitem_id BIGINT UNSIGNED NOT NULL COMMENT '关联工单 ID',
  conversation_id BIGINT UNSIGNED NOT NULL COMMENT '设计会话 ID',
  source_key VARCHAR(128) NOT NULL COMMENT '设计源工程和目标配置的标识',
  token VARCHAR(64) NOT NULL COMMENT '分享链接使用的访问标识',
  enabled TINYINT NOT NULL DEFAULT 1 COMMENT '分享启用标志，1 为启用',
  version INT NOT NULL DEFAULT 1 COMMENT '分享授权版本，用于使旧授权失效',
  creator_id BIGINT UNSIGNED NOT NULL COMMENT '创建人用户 ID',
  UNIQUE KEY uk_review_share_scope(workspace_id,conversation_id,source_key),
  UNIQUE KEY uk_review_share_token(token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PRD 设计评审分享链接';

CREATE TABLE IF NOT EXISTS prd_review_preview_grant (
  token_hash CHAR(64) NOT NULL PRIMARY KEY COMMENT '预览授权令牌的 SHA-256 十六进制摘要',
  kind VARCHAR(16) NOT NULL COMMENT '授权类型，区分一次性入口码和预览会话',
  share_id BIGINT UNSIGNED NOT NULL COMMENT '关联分享记录 ID，成员预览为 0',
  share_version INT NOT NULL COMMENT '授权签发时的分享记录版本',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '授权关联的用户 ID',
  binding_id VARCHAR(100) NOT NULL COMMENT '平台预览入口绑定标识',
  expires_at DATETIME(3) NOT NULL COMMENT '授权过期时间',
  consumed TINYINT NOT NULL DEFAULT 0 COMMENT '一次性入口码使用标志，1 为已使用',
  KEY idx_preview_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PRD 实时预览短期授权';

CREATE TABLE IF NOT EXISTS prd_review_tunnel (
  workspace_id BIGINT UNSIGNED NOT NULL COMMENT '工作空间 ID',
  conversation_id BIGINT UNSIGNED NOT NULL COMMENT '设计会话 ID',
  executor_id BIGINT UNSIGNED NOT NULL COMMENT '运行预览的执行器 ID',
  turn_id BIGINT UNSIGNED NOT NULL COMMENT '本次上报所属的设计对话轮次 ID',
  dispatch_attempt INT NOT NULL COMMENT '轮次的派发尝试序号',
  report_sequence INT NOT NULL COMMENT '同一次派发尝试内的状态上报序号',
  binding_id VARCHAR(100) NOT NULL COMMENT '平台预览入口绑定标识',
  status VARCHAR(16) NOT NULL COMMENT '预览入口最近一次上报的连接状态',
  PRIMARY KEY(workspace_id,conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PRD 预览入口登记和状态上报';

CREATE TABLE IF NOT EXISTS prd_review_comment (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '评审评论 ID',
  workspace_id BIGINT UNSIGNED NOT NULL COMMENT '工作空间 ID',
  workitem_id BIGINT UNSIGNED NOT NULL COMMENT '关联工单 ID',
  conversation_id BIGINT UNSIGNED NOT NULL COMMENT '设计会话 ID',
  source_key VARCHAR(128) NOT NULL COMMENT '设计源工程和目标配置的标识',
  runtime_revision BIGINT NOT NULL COMMENT '发表评论时的设计预览修订号',
  route_path VARCHAR(2048) NOT NULL COMMENT '评论所关联的预览页面路由',
  selector VARCHAR(1000) NOT NULL COMMENT '评论所锚定的页面元素选择器',
  element_json TEXT NOT NULL COMMENT '锚定元素的描述和定位信息 JSON',
  comment_text TEXT NOT NULL COMMENT '评审评论正文',
  status VARCHAR(16) NOT NULL DEFAULT 'open' COMMENT '评论处理状态',
  creator_id BIGINT UNSIGNED NOT NULL COMMENT '创建人用户 ID',
  client_id VARCHAR(100) NOT NULL COMMENT '客户端请求标识，用于评论去重',
  version INT NOT NULL DEFAULT 0 COMMENT '评论记录版本，用于并发更新校验',
  is_deleted TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标志，1 为已删除',
  last_sent_turn_id BIGINT UNSIGNED DEFAULT NULL COMMENT '评论最近发送给设计助手的对话轮次 ID',
  gmt_create DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '评论创建时间',
  gmt_modified DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '记录最近修改时间',
  UNIQUE KEY uk_review_comment_replay(workspace_id,conversation_id,source_key,creator_id,client_id),
  KEY idx_review_comments(workspace_id,workitem_id,conversation_id,is_deleted,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PRD 设计评审评论';
