-- 启动自愈可能已应用同一条 ALTER，三个定义总是在同一语句中添加。
SET @prd_review_slug_ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE prd_design
      ADD COLUMN review_slug VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin COMMENT ''公开分享英文名'',
      ADD COLUMN review_share_id BIGINT UNSIGNED DEFAULT NULL COMMENT ''英文名绑定的分享记录'',
      ADD UNIQUE KEY uk_prd_design_review_slug (review_slug)',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prd_design' AND COLUMN_NAME = 'review_slug'
);
PREPARE stmt FROM @prd_review_slug_ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
