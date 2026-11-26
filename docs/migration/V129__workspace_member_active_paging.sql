-- The MCP member directory pages active rows in stable join order.
SET @member_paging_ddl = IF(EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'org_member'
      AND index_name = 'idx_member_active_joined'
), 'SELECT 1', 'ALTER TABLE org_member ADD INDEX idx_member_active_joined (tenant_id, is_deleted, status, joined_at, id), ALGORITHM=INPLACE, LOCK=NONE');
PREPARE member_paging_stmt FROM @member_paging_ddl;
EXECUTE member_paging_stmt;
DEALLOCATE PREPARE member_paging_stmt;
