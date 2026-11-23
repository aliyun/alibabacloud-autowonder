-- Consolidate the V119 lookup index and the local identity constraint in one online ALTER.
-- Existing installations with a different equivalent index keep their original definition.
SELECT
  MAX(CASE WHEN index_name = 'uk_local_workitem' AND non_unique = 0 THEN indexed_columns END),
  MAX(CASE WHEN index_name = 'idx_external_link_tenant_workitem' AND non_unique = 1 THEN indexed_columns END)
INTO @local_unique_columns, @v084_lookup_columns
FROM (
  SELECT index_name, non_unique,
         GROUP_CONCAT(COALESCE(column_name, '<expression>') ORDER BY seq_in_index) AS indexed_columns
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'external_workitem_link'
    AND index_name IN ('uk_local_workitem', 'idx_external_link_tenant_workitem')
    AND index_type = 'BTREE' AND is_visible = 'YES'
  GROUP BY index_name, non_unique
  HAVING COUNT(sub_part) = 0 AND COUNT(*) = SUM(collation = 'A')
) AS local_indexes;

SET @external_link_consolidation = CASE
  WHEN @v084_lookup_columns = 'tenant_id,workitem_id' AND @local_unique_columns = 'tenant_id,provider,workitem_id'
    THEN 'ALTER TABLE external_workitem_link DROP INDEX uk_local_workitem, ADD UNIQUE INDEX uk_local_workitem (tenant_id, workitem_id, provider), DROP INDEX idx_external_link_tenant_workitem, ALGORITHM=INPLACE, LOCK=NONE'
  WHEN @v084_lookup_columns = 'tenant_id,workitem_id' AND @local_unique_columns = 'tenant_id,workitem_id,provider'
    THEN 'ALTER TABLE external_workitem_link DROP INDEX idx_external_link_tenant_workitem, ALGORITHM=INPLACE, LOCK=NONE'
  ELSE 'SELECT 1'
END;
PREPARE external_link_consolidation_stmt FROM @external_link_consolidation;
EXECUTE external_link_consolidation_stmt;
DEALLOCATE PREPARE external_link_consolidation_stmt;
