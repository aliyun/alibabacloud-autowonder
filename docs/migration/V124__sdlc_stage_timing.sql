-- Apply before deploying the server: dispatch step queries read this column even when timing is off.
-- Existing workflows default to timing off.
SET @stage_timing_ddl = IF(EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE()
      AND table_name = 'sdlc' AND column_name = 'stage_timing_enabled'
), 'SELECT 1', 'ALTER TABLE sdlc ADD COLUMN stage_timing_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''记录流程阶段耗时和派发时的分析快照，0 关闭，1 开启'', ALGORITHM=INSTANT');
PREPARE stage_timing_stmt FROM @stage_timing_ddl;
EXECUTE stage_timing_stmt;
DEALLOCATE PREPARE stage_timing_stmt;
