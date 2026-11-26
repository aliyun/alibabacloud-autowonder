package com.aliyun.autowonder.sdlc;

import com.aliyun.autowonder.dispatch.DispatchDO;
import org.apache.ibatis.annotations.*;

import java.util.Date;

@Mapper
public interface SdlcExecutionSnapshotDao {
    @Insert("INSERT INTO sdlc_execution_snapshot (workspace_id,sdlc_id,content_hash,configuration_json) "
            + "VALUES (#{workspaceId},#{sdlcId},#{contentHash},#{configurationJson}) ON DUPLICATE KEY UPDATE id=id")
    int insert(SdlcExecutionSnapshot snapshot);

    @Select("SELECT id,workspace_id,sdlc_id,content_hash,configuration_json,gmt_create FROM sdlc_execution_snapshot "
            + "WHERE workspace_id=#{workspaceId} AND sdlc_id=#{sdlcId} AND content_hash=#{hash}")
    SdlcExecutionSnapshot find(@Param("workspaceId") long workspaceId, @Param("sdlcId") long sdlcId, @Param("hash") String hash);

    @Insert("INSERT INTO dispatch_sdlc_snapshot (workspace_id,dispatch_id,snapshot_id,package_sha256,source) "
            + "SELECT #{workspaceId},#{dispatchId},#{snapshotId},#{packageHash},'CAPTURED' FROM dispatch "
            + "WHERE tenant_id=#{workspaceId} AND id=#{dispatchId} AND status='DISPATCHED' "
            + "AND version=#{version} AND package_oss_ref=#{packageRef} "
            + "ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id),package_sha256=VALUES(package_sha256),source='CAPTURED'")
    int capture(@Param("workspaceId") long workspaceId, @Param("dispatchId") long dispatchId,
                @Param("snapshotId") long snapshotId, @Param("packageHash") String packageHash,
                @Param("version") int version, @Param("packageRef") String packageRef);

    @Select("SELECT snapshot_sha256 FROM dispatch_workflow_snapshot WHERE tenant_id=#{dispatch.tenantId} "
            + "AND dispatch_id=#{dispatch.id} AND workitem_id=#{dispatch.workitemId} AND gmt_create <= #{firstEventAt}")
    String frozenWorkflowHash(@Param("dispatch") DispatchDO dispatch, @Param("firstEventAt") Date firstEventAt);

    @Select("SELECT COUNT(*) > 0 FROM dispatch_sdlc_snapshot WHERE workspace_id=#{workspaceId} "
            + "AND dispatch_id=#{dispatchId} AND snapshot_id IS NOT NULL AND source IN ('CAPTURED','RECOVERED_FROZEN')")
    boolean hasVerifiedBinding(@Param("workspaceId") long workspaceId, @Param("dispatchId") long dispatchId);

    @Insert("INSERT INTO dispatch_sdlc_snapshot (workspace_id,dispatch_id,snapshot_id,package_sha256,source) "
            + "SELECT tenant_id,id,#{snapshotId},#{packageHash},#{source} FROM dispatch "
            + "WHERE tenant_id=#{dispatch.tenantId} AND id=#{dispatch.id} AND is_deleted=0 "
            + "AND version=#{dispatch.version} AND status=#{dispatch.status} "
            + "AND status IN ('SUCCEEDED','FAILED','TIMEOUT','CANCELED') "
            + "AND (package_oss_ref=#{dispatch.packageOssRef} OR (package_oss_ref IS NULL AND #{dispatch.packageOssRef} IS NULL)) "
            + "ON DUPLICATE KEY UPDATE "
            + "snapshot_id=CASE WHEN source IN ('UNAVAILABLE','UNVERIFIED','RECOVERED') THEN VALUES(snapshot_id) ELSE snapshot_id END, "
            + "package_sha256=CASE WHEN source IN ('UNAVAILABLE','UNVERIFIED','RECOVERED') THEN VALUES(package_sha256) ELSE package_sha256 END, "
            + "source=CASE WHEN source IN ('UNAVAILABLE','UNVERIFIED','RECOVERED') THEN VALUES(source) ELSE source END")
    int recover(@Param("dispatch") DispatchDO dispatch, @Param("snapshotId") Long snapshotId,
                @Param("packageHash") String packageHash, @Param("source") String source);
}
