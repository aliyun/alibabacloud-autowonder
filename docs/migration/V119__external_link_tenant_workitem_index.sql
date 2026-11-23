-- List and detail views look up local workitems across all providers.
-- Reuse any visible BTREE with this leading pair, including a longer index.
SET @external_link_index_ddl = IF(EXISTS (
  SELECT 1 FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'external_workitem_link'
    AND index_type = 'BTREE' AND is_visible = 'YES'
    AND ((seq_in_index = 1 AND column_name = 'tenant_id')
      OR (seq_in_index = 2 AND column_name = 'workitem_id'))
  GROUP BY index_name HAVING COUNT(*) = 2
), 'SELECT 1',
  'ALTER TABLE external_workitem_link ADD INDEX idx_external_link_tenant_workitem (tenant_id, workitem_id), ALGORITHM=INPLACE, LOCK=NONE');
PREPARE external_link_index_stmt FROM @external_link_index_ddl;
EXECUTE external_link_index_stmt;
DEALLOCATE PREPARE external_link_index_stmt;
