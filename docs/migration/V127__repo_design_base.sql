SET @repo_design_base_ddl = IF(EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'repo' AND column_name = 'design_base_branch'
), 'SELECT 1', 'ALTER TABLE repo ADD COLUMN design_base_branch VARCHAR(128) DEFAULT NULL COMMENT ''交互设计基线分支''');
PREPARE repo_design_base_stmt FROM @repo_design_base_ddl;
EXECUTE repo_design_base_stmt;
DEALLOCATE PREPARE repo_design_base_stmt;
