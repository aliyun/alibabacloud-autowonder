-- SSO 账号开通映射与已有账号绑定（工单 #59708）：
--   username_claim            认证结果中 AutoWonder 用户名的声明名；空表示沿用旧的随机 sso_ 用户名建号行为。
--   bind_existing_by_username 是否允许按映射用户名匹配并绑定本地已有账号（默认关闭，需同时配置 username_claim）。
-- 存量数据库执行一次本迁移；新建数据库使用 docs/autowonder-schema.sql。
-- 不会自动执行迁移：请在发布代码前手动执行；先迁移、再发布服务端与前端。
--
-- 兼容性：两列默认值保持旧行为（不按映射建号、不认领已有账号），升级后不会批量改名或意外绑定。
-- 重复执行：加列前先查 information_schema，可安全重跑。

SET @ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `federation_connection` ADD COLUMN `username_claim` VARCHAR(128) DEFAULT NULL COMMENT ''认证结果中 AutoWonder 用户名的声明名；空为沿用随机用户名'' AFTER `email_claim`',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'federation_connection' AND COLUMN_NAME = 'username_claim'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `federation_connection` ADD COLUMN `bind_existing_by_username` TINYINT NOT NULL DEFAULT 0 COMMENT ''0 关闭 / 1 按映射用户名绑定本地已有账号'' AFTER `feishu_user_id_claim`',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'federation_connection' AND COLUMN_NAME = 'bind_existing_by_username'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
