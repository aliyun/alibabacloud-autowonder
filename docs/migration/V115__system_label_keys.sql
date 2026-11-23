-- 系统文案来源键（Aone 88163854 / 工单 #57092）。
-- 存量数据库执行一次本迁移；新建数据库使用 docs/autowonder-schema.sql。
-- 不会自动执行迁移：请在发布代码前手动执行；先迁移、再发布服务端。
--
-- 模型：
--   status_template.system_label_key      系统播种模板名称的展示键；用户改名后置 NULL。
--   status_node.system_label_key          系统播种节点名称的展示键；用户改 name/code 后置 NULL。
--   status_transition.system_label_key    系统播种流转名称的展示键；用户改名后置 NULL。
--   environment_variable.description_label_key
--                                         预置说明的展示键；用户编辑说明或改名后置 NULL。
--   原 name/description 列保持业务原值，前端按展示键本地化；旧记录不按名称、中文原文或 code
--   猜测来源，保持原文并由人工审核路径认定。
--
-- 重复执行：加列前先查 information_schema，可安全重跑。

SET @ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `status_template` ADD COLUMN `system_label_key` VARCHAR(64) DEFAULT NULL COMMENT ''系统来源展示键；用户改名后置空'' AFTER `name`',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'status_template' AND COLUMN_NAME = 'system_label_key'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `status_node` ADD COLUMN `system_label_key` VARCHAR(64) DEFAULT NULL COMMENT ''系统来源展示键；用户改名称或 code 后置空'' AFTER `name`',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'status_node' AND COLUMN_NAME = 'system_label_key'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `status_transition` ADD COLUMN `system_label_key` VARCHAR(64) DEFAULT NULL COMMENT ''系统来源展示键；用户改名后置空'' AFTER `name`',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'status_transition' AND COLUMN_NAME = 'system_label_key'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `environment_variable` ADD COLUMN `description_label_key` VARCHAR(64) DEFAULT NULL COMMENT ''预置说明展示键；用户编辑说明或改名后置空'' AFTER `description`',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'environment_variable' AND COLUMN_NAME = 'description_label_key'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
