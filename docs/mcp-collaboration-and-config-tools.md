# MCP 协作与配置工具

工单日常协作与配置能力此前只有页面和 REST 入口。本次把它们开放为内置 `autowonder` MCP server 的通用工具，参数与权限沿用对应页面/接口，不新增 REST 路由，不改变数据库结构。

- Endpoint: `POST <publicBaseUrl>/api/mcp`（JSON-RPC, streamable HTTP）
- Auth: `Authorization: Bearer <token>` 或 `?token=<token>`
- 每个工具都要求 `workspaceId`（可用 `autowonder.list_projects` 获取），权限按 `(workspaceId, userId)` 实时解析成员等级。

## 工具清单与权限

| 域 | 工具 | 最低权限 | 复用服务 |
|---|---|---|---|
| 工作项协作 | `autowonder.watch_workitem`（`action=watch\|unwatch`） | READ_ONLY | `WorkitemWatcherService` |
| 工作项协作 | `autowonder.list_workitem_watchers` | READ_ONLY | `WorkitemWatcherService` |
| 工作项协作 | `autowonder.get_workitem_timeline` | READ_ONLY | `WorkitemService.getUnifiedTimeline` + `GuidanceService` |
| 工作项协作 | `autowonder.get_workitem_participants` | READ_ONLY | `WorkitemService.getParticipants` |
| 工作项协作 | `autowonder.get_workitem_delivery_progress` | READ_ONLY | `WorkitemService.getDeliveryProgress` |
| 环境变量 | `autowonder.list_environment_variables` | READ_ONLY | `EnvironmentVariableService.list` |
| 环境变量 | `autowonder.create_environment_variable` | ADMIN | `EnvironmentVariableService.create` |
| 环境变量 | `autowonder.update_environment_variable` | ADMIN | `EnvironmentVariableService.update` |
| 环境变量挂载 | `autowonder.bind_agent_environment_variables` | READ_WRITE | `AgentService.addEnvironmentVariableRef` |
| 环境变量挂载 | `autowonder.unbind_agent_environment_variables` | READ_WRITE | `AgentService.removeEnvironmentVariableRef` |
| 数字员工 | `autowonder.bind_agent_memories` | READ_WRITE | `AgentService.addMemoryRef` |
| 数字员工 | `autowonder.unbind_agent_memories` | READ_WRITE | `AgentService.removeMemoryRef` |
| 团队（小队） | `autowonder.update_squad` | READ_WRITE | `SquadService.update` |
| 能力包 | `autowonder.list_skill_package_files` | READ_ONLY | `SkillPackageService.listPackageFiles` |
| 能力包 | `autowonder.get_skill_package_file` | READ_ONLY | `SkillPackageService.readPackageFile` |
| 能力包 | `autowonder.download_skill_package` | READ_ONLY | `SkillPackageService.loadPackage` |
| 能力包 | `autowonder.test_skill_connection` | READ_WRITE | `SkillConnectionTestService.test` |
| 执行器 | `autowonder.get_executor_model_upgrade_policy` | READ_ONLY | `ExecutorLaunchConfigService.readStoredConfig` |
| 执行器 | `autowonder.preview_executor_launch_command` | ADMIN | `ExecutorLaunchCommandService.previewForExecutorRedacted` |

`watch_workitem` 与页面一致按 READ_ONLY 放行：关注是调用者自己的个人订阅，不授予工单写权限。

## 私密信息边界

| 工具 | 处理 |
|---|---|
| `list_environment_variables` / `create_environment_variable` / `update_environment_variable` | 服务层 VO 的 `value` 恒为 `**`。明文只在请求方向出现，落库前加密；MCP 不会回显明文。写操作沿用服务层审计。 |
| `get_skill_package_file` | 仅返回包内文本文件（二进制由包服务拒绝）。内容经 `RuntimeActionSanitizer.looksSensitive` 检查，仍含可识别凭证则拒绝；单文件上限 256K 字符。 |
| `download_skill_package` | 包体积上限 1 MiB，超限拒绝并提示到页面下载；返回前逐条扫描文本条目，命中凭证或超出 1 MiB 校验预算即整体拒绝。返回 base64 与 SHA-256，不返回签名 URL。 |
| `test_skill_connection` | `message` 与发现工具的名称/描述都经 `RuntimeActionSanitizer.sanitizeFull` 脱敏，不返回请求头或令牌。 |
| `preview_executor_launch_command` | 命令由服务层用占位令牌 `<executor-token>` 生成，任何分支（含 PowerShell 编码）都不包含真实执行器令牌；真实令牌仍只能由管理员通过 `get_executor_token` 或页面获取。该工具同时属于 dispatch 凭据禁用集合。 |

## 行为说明

- 环境变量挂载/解除挂载、记忆绑定/解绑都写入数字员工的**编辑草稿**，只有走完既有的提交评审与发布流程后才对在线版本生效。重复 id 会去重，已存在/不存在的绑定都是幂等 no-op。
- `update_squad` 采用读改写：只传需要修改的字段，未传字段沿用当前值，避免小队更新 SQL 整体覆盖造成意外清空；至少需要提供一个字段。
- `update_environment_variable` 与页面一致必须显式传 `updateValue`：`true` 时 `value` 必填，`false` 时只更新名称与说明（`description` 是完整表单字段，省略即清空）。
- `get_workitem_timeline` 返回详情页的统一时间线（工单事件、评论、澄清对话、交付动态并附带互动状态）；交付步骤与数字人进度请用 `get_workitem_delivery_progress`。
- `preview_executor_launch_command` 不落库：`config` 中的 `version` 必须是当前启动配置版本，校验规则与 `update_executor_launch_config` 完全一致。

## 测试

`McpToolServiceTest` 覆盖：工具目录集合与计数、只读/写/管理员权限边界、跨空间与依赖缺失（fail closed）、敏感内容与超限拒绝、命令预览不含令牌、dispatch 凭据禁用、参数校验分支。运行方式见仓库根 `AGENTS.md` 的后端测试命令。
