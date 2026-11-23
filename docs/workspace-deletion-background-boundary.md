# 工作空间软删除 = 后台运行边界

工单 #59363。工作空间（`org` 行）逻辑删除后，不再执行该空间的任何后台业务，也不再发送该空间的通知。
历史数据与审计记录全部保留，其他有效空间不受影响。

## 1. 覆盖入口清单

| 类别 | 入口 | 边界实现 |
| --- | --- | --- |
| 外部同步（入站） | `AoneCommentPoller`（3s）、`AoneInboundPoller`（3s）、`AoneReconcilePoller`（5min） | `ExternalProjectBindingDao.listEnabled` 内联 `INNER JOIN org ... is_deleted = 0`；每条绑定处理前再查一次空间有效性 |
| 外部同步（出站） | `AoneOutboxDispatcher`（3s） | 派发每条 outbox 前校验空间，已删除则终态失败，不再外呼 |
| 业务写入 | `AoneInboundSyncService#syncWorkitems / syncLinkedWorkitem / syncLinkedComments / reconcileLinkedWorkitems` | 入口校验，晚到批次直接返回空结果：不写评论/链接、不触发 guidance、不产生通知 |
| 通知 | `NotifyService`（站内 + IM 渠道） | `WORKSPACE` 域事件在持久化前校验；`AFTER_COMMIT` 延迟 IM 投递前再校验。`PLATFORM` 域不受影响 |
| 定时任务 | `ScheduledTaskScheduler`、`ScheduledTaskRunCompensationTask` | 扫描/补偿前校验；命中已删除空间时把 ACTIVE 任务置为 PAUSED 并跳过 |
| 自动派发 | `DispatchAdmissionService`、`DispatchCompensationTask` | 终态准入返回 `WORKSPACE_DELETED`（不再退化成 `AGENT_OFFLINE`）；补偿不再重驱动 |
| 删除联动 | `WorkspaceDeletionLinkage` | 新增 `disableExternalBindings`：删除事务内 `enabled=1 -> 0`（`enabled=1` 为乐观条件，可重复执行） |
| 历史数据 | `WorkspaceBackgroundGovernanceTask` | 每小时治理扫描，收敛删除前遗留的启用绑定 / ACTIVE 任务 / 非终态 dispatch |

平台共享机器人绑定（feishu/dingtalk `SHARED`）在删除时保持既有行为：事务内禁用。
`LEGACY` 绑定持有自己的凭证，仍需操作人显式禁用（既有设计边界）。

## 2. 竞态处理

- **调度到执行之间**：`listEnabled` 是权威过滤，删除提交后不会再有新的轮询周期拿到该绑定；
  轮询器对每条绑定再校验一次，覆盖“已取到绑定、删除在轮询中提交”。
- **删除到通知之间**：`NotifyService` 在写入前校验，并在 `AFTER_COMMIT` 延迟 IM 投递前再校验；
  已落库的站内通知属于已提交事务的一部分，不回滚。
- **删除到派发之间**：`DispatchAdmissionService` 在 `PACKAGING -> DISPATCHED` CAS 之前校验空间，
  删除先提交则拒绝发送；否则由删除后的联动停止在途 dispatch。
- **迟到结果**：`AoneInboundSyncService` 四个后台入口校验空间，删除后到达的批次不写业务数据。

## 3. 历史数据治理（可重复执行）

`WorkspaceBackgroundGovernanceTask`（默认每小时，Redis 集群锁，批量 100）：

1. 选出「已逻辑删除且仍有后台残留」的空间：存在 `enabled=1` 的外部绑定、`ACTIVE` 定时任务、
   或非终态 dispatch。三支 SQL 都与 `org.is_deleted = 1` 内联连接，有效空间不可能入选；
2. 对每个空间复用删除联动的三件事：禁用外部绑定、暂停 ACTIVE 任务、停止在途 dispatch；
3. 残留清空后该空间自动退出候选集，因此重复执行是幂等的 no-op，不会影响有效空间。

工单中的历史空间 10010 由该任务在部署后的下一个周期自动收敛，不删除任何业务数据与审计记录。

验证 SQL（运维核查，只读）：

```sql
-- 该空间是否还有后台残留（三行都应为 0）
SELECT
  (SELECT COUNT(*) FROM external_project_binding
    WHERE tenant_id = 10010 AND enabled = 1 AND is_deleted = 0) AS enabled_bindings,
  (SELECT COUNT(*) FROM scheduled_task
    WHERE workspace_id = 10010 AND status = 'ACTIVE' AND is_deleted = 0) AS active_tasks,
  (SELECT COUNT(*) FROM dispatch
    WHERE tenant_id = 10010 AND is_deleted = 0
      AND status IN ('PENDING','PACKAGING','WAITING_FOR_PAUSE','DISPATCHED','ACKED','RUNNING','PAUSING','PAUSE_FAILED')
  ) AS in_flight_dispatches;

-- 治理后的绑定行（数据保留，仅 enabled=0）
SELECT id, tenant_id, provider, external_project_id, enabled, is_deleted, version
FROM external_project_binding WHERE tenant_id = 10010;
```

停止原因可直接从 `org.deleted_at/deleted_by`、删除时的 `ORG_DELETED` 审计（detail 含
`disabledExternalBindings` 等计数）以及治理任务日志
（`workspace background governance tenantId=... disabledExternalBindings=... pausedScheduledTasks=... stoppedDispatches=...`）确认。

## 4. 已知外部副作用（不可撤回）

- 已发出的站内通知、已投递的 IM 消息、已发送到 Aone 的外部请求无法撤回；
  本次只保证删除提交后不再产生新的投递。
- 删除与投递之间的极小竞态窗口用「投递前校验 + 下一次幂等收尾」缩小，不做分布式锁。
- Aone 评论水位在删除期间的跳过窗口不会回放：恢复后从新窗口继续同步。

## 5. 恢复策略（需人工确认）

`WorkspaceService.restoreWorkspace` 只把 `org` 行恢复为有效，**不自动恢复**：

- 外部项目绑定保持 `enabled=0`；
- 定时任务保持 `PAUSED`；
- 共享/LEGACY 机器人绑定保持禁用/原状态；
- 已停止的 dispatch 不会自动重启。

操作人需在确认后显式重新启用绑定与任务。审计 detail 记录
`scheduledTasksResumed=false`、`externalBindingsResumed=false`，不会因恢复产生消息洪泛。
