-- 平台邮箱验证与邮箱后缀约束（工单 #59313）。
-- 存量数据库执行一次本迁移；新建数据库使用 docs/autowonder-schema.sql。
-- 不会自动执行迁移：请在发布代码前手动执行；先迁移、再发布服务端与前端。
--
-- 模型：
--   user.verified_email/verified_at        最近一次成功验证的邮箱快照；当前 email 不等于该值即未验证。
--   user.first_verified_at                 首次验证成功时间；用于区分"新账号首次验证"与"存量账号"。
--   user.verification_invalidated          后缀策略变更等导致的验证失效标记；重新加入后缀不自动恢复。
--   platform_email_policy                  单行策略：总开关、存量强制、后缀约束、启用周期起点、策略版本。
--   platform_mail_settings                 单行 SMTP 配置：draft/active 版本、密钥版本、测试指纹与结果。
--   platform_email_verification_notice     强制验证开启通知去重（按策略版本，失败可重试）。
--
-- 重复执行：加列前先查 information_schema；CREATE TABLE 带 IF NOT EXISTS，可安全重跑。

SET @ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `user` ADD COLUMN `verified_email` VARCHAR(128) DEFAULT NULL COMMENT ''最近一次验证成功的邮箱快照；与 email 不一致即未验证'' AFTER `email`',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND COLUMN_NAME = 'verified_email'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `user` ADD COLUMN `verified_at` DATETIME(3) DEFAULT NULL COMMENT ''最近一次验证成功时间'' AFTER `verified_email`',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND COLUMN_NAME = 'verified_at'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `user` ADD COLUMN `first_verified_at` DATETIME(3) DEFAULT NULL COMMENT ''首次验证成功时间；用于区分新账号首次验证'' AFTER `verified_at`',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND COLUMN_NAME = 'first_verified_at'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `user` ADD COLUMN `verification_invalidated` TINYINT NOT NULL DEFAULT 0 COMMENT ''0 有效 / 1 被后缀策略等置为需重新验证'' AFTER `first_verified_at`',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND COLUMN_NAME = 'verification_invalidated'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `platform_email_policy` (
  `id`                        TINYINT      NOT NULL DEFAULT 1 COMMENT '固定单行',
  `verification_enabled`      TINYINT      NOT NULL DEFAULT 0 COMMENT '邮箱验证总开关',
  `force_existing_enabled`    TINYINT      NOT NULL DEFAULT 0 COMMENT '强制存量用户验证',
  `suffix_restriction_enabled` TINYINT     NOT NULL DEFAULT 0 COMMENT '邮箱后缀约束开关',
  `allowed_suffixes`          TEXT         DEFAULT NULL COMMENT '允许的完整域名列表，按逗号分隔，已规范化',
  `period_started_at`         DATETIME(3)  DEFAULT NULL COMMENT '最近一次开启总开关的时间；此前账号按存量处理',
  `policy_version`            BIGINT       NOT NULL DEFAULT 0 COMMENT '策略乐观锁版本',
  `updated_by`                BIGINT UNSIGNED DEFAULT NULL COMMENT '最近修改人',
  `gmt_create`                DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified`              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台邮箱验证策略（单行）';

CREATE TABLE IF NOT EXISTS `platform_mail_settings` (
  `id`                    TINYINT        NOT NULL DEFAULT 1 COMMENT '固定单行',
  `draft_config`          TEXT           DEFAULT NULL COMMENT '草稿发信配置 JSON（不含密钥）',
  `active_config`         TEXT           DEFAULT NULL COMMENT '生效发信配置 JSON（不含密钥）',
  `draft_secret_ref`      MEDIUMTEXT   DEFAULT NULL COMMENT '草稿密钥加密引用',
  `active_secret_ref`     MEDIUMTEXT   DEFAULT NULL COMMENT '生效密钥加密引用',
  `draft_secret_version`  BIGINT         NOT NULL DEFAULT 0 COMMENT '草稿密钥版本',
  `active_secret_version` BIGINT         NOT NULL DEFAULT 0 COMMENT '生效密钥版本',
  `draft_version`         BIGINT         NOT NULL DEFAULT 0 COMMENT '草稿乐观锁版本',
  `active_version`        BIGINT         NOT NULL DEFAULT 0 COMMENT '生效乐观锁版本',
  `tested_fingerprint`    CHAR(64)       DEFAULT NULL COMMENT '最近一次成功测试的配置指纹',
  `tested_at`             DATETIME(3)    DEFAULT NULL COMMENT '最近一次成功测试时间',
  `test_success`          TINYINT        NOT NULL DEFAULT 0 COMMENT '最近一次测试是否成功',
  `test_result`           VARCHAR(512)   DEFAULT NULL COMMENT '最近一次测试的脱敏结果',
  `updated_by`            BIGINT UNSIGNED DEFAULT NULL COMMENT '最近修改人',
  `gmt_create`            DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified`          DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台邮件发送配置（单行）';

CREATE TABLE IF NOT EXISTS `platform_email_verification_notice` (
  `policy_version` BIGINT      NOT NULL COMMENT '触发通知的策略版本',
  `notified_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `recipient_count` INT        NOT NULL DEFAULT 0,
  `failure_count`  INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (`policy_version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='强制存量验证开启通知去重';
