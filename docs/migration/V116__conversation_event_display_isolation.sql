-- 会话执行展示：实时/历史队列隔离与持久扫描进度（59314 实时性回归修复）。
-- Additive only: 原始事件表、历史正文与派生的已发布内容都不改写。

ALTER TABLE conversation_event_display
  ADD COLUMN queue_class VARCHAR(16) NOT NULL DEFAULT 'REALTIME';

-- 升级已有 PREPARING 时只按年龄做保守二分：gmt_create 在 30 分钟内的视为
-- 「活动轮次或刚终态未排空」，保留实时优先级；更早的进入历史通道。
-- 该 30 分钟窗口只是升级时刻的一次性启发式，不是运行期规则：
--   * 运行期「被打开的轮次」由读取时的 promoteTurn 提升为 INTERACTIVE；
--   * 「刚终态未排空」留在 REALTIME 队列继续被实时 tick 消化；
-- 因此窗口只影响升级瞬间的积压分类，调小窗口只会让更多旧积压进入历史通道，
-- 不会让新会话排到积压之后。A8 升级验证需观察该窗口内的轮次是否及时排空。
UPDATE conversation_event_display
   SET queue_class = CASE
         WHEN gmt_create >= DATE_SUB(NOW(3), INTERVAL 30 MINUTE) THEN 'REALTIME'
         ELSE 'HISTORY'
       END
 WHERE status = 'PREPARING';

-- 认领索引与 listClaimableIdsByClass 的 ORDER BY (turn_id DESC, id ASC) 对齐，
-- 避免在全部 PREPARING 行上 filesort。
ALTER TABLE conversation_event_display
  ADD KEY idx_display_claim_class (status, queue_class, turn_id, id),
  ADD KEY idx_display_turn_class (tenant_id, conversation_id, turn_id, status, queue_class);

-- 后台历史发现的有界扫描 checkpoint：只记录原始表主键范围与高水位，
-- 每个实例共享同一进度行，重启/多实例都不会退回全表扫描。
-- 注意：本迁移发布前若在本地/测试环境执行过草稿版本，CREATE TABLE IF NOT EXISTS
-- 不会为已存在的表补 quiet_until，需要先 DROP TABLE conversation_event_display_scan
-- 再重跑本文件，或手工执行：
--   ALTER TABLE conversation_event_display_scan
--     ADD COLUMN quiet_until DATETIME(3) NULL AFTER generation;
-- quiet_until：最近一轮完整扫描没有补建任何行时顺延下一次后台扫描，
-- 避免 3.56M 规模下每 2 秒都从 0 做一遍全表主键遍历。
CREATE TABLE IF NOT EXISTS conversation_event_display_scan (
  scan_key VARCHAR(32) NOT NULL,
  last_raw_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  high_water_raw_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  generation BIGINT NOT NULL DEFAULT 0,
  quiet_until DATETIME(3) NULL,
  gmt_modified DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (scan_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会话展示历史发现进度';
