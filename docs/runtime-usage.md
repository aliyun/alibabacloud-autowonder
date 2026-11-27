# Runtime Usage — AutoWonder 客户端运行时使用指南

AutoWonder 客户端运行时（Runtime）运行在执行机上，负责连接平台、领取任务并调用本机的 Qoder CLI 或 Qoder CLI CN。Runtime 从 `0.3.33` 起通过 [`@alicloud/autowonder`](https://www.npmjs.com/package/@alicloud/autowonder) 分发，更早的固定版本使用 `autowonder` 包。安装后的命令仍叫 `autowonder`。

## 1. 环境要求

| 项 | 要求 |
|---|---|
| Node.js 和 npm | 执行 Qoder 系列任务需要 Node.js 20 或更高版本。通过 `npx` 启动时需要 npm。 |
| Agent CLI | 在执行机上安装并登录与执行器配置匹配的 Qoder CLI 或 Qoder CLI CN。 |
| 网络 | 执行机可以访问 npm 仓库及平台的 WebSocket 端点。 |

## 2. 接入平台执行器

1. 管理员在「执行器管理」打开目标执行器的「启动命令」。新建执行器时，选择与执行机匹配的 Qoder CLI 或 Qoder CLI CN。
2. 选择执行机的系统（macOS / Linux 或 Windows），点击「复制启动命令」。平台会填入连接地址、执行器令牌及启动参数，并按执行器固定版本或部署推荐版本选择 npm 包和精确版本。
3. 在执行机的终端粘贴并执行完整命令。Windows 使用 PowerShell。保持进程运行，并在平台确认执行器已上线。

## 3. 命令与常用参数

下表使用已安装的 `autowonder` 可执行文件语法。平台接入和工单附件操作可分别使用平台和 MCP 返回的命令。

| 命令 | 说明 |
|---|---|
| `autowonder connect` | 前台连接平台。使用上节复制的完整命令。 |
| `autowonder start [--provider qoder]` | 在本地模式下后台启动 daemon。 |
| `autowonder stop` | 停止后台 daemon。 |
| `autowonder status` | 查看 daemon 状态与健康信息。 |
| `autowonder dispatch <assignment.json>` | 在本地模式下提交任务。 |
| `autowonder install [--force]` | 安装或更新 daemon 二进制并启动。 |
| `autowonder workitem upload` | 上传本地附件。使用 MCP 返回的带上传凭据的命令。 |
| `autowonder workitem download` | 下载工单附件。使用 MCP 返回的带下载凭据的命令。 |

### 常用启动参数

| 参数 | 说明 |
|---|---|
| `--provider <name>` | `qoder` 或 `qodercn`。使用 Qoder CLI CN 时显式指定 `qodercn`。 |
| `--max-tasks <n>` | 执行器的最大并发任务数。平台可配置 1–10，默认传入 5。直接运行 `connect` 时省略该参数，CLI 默认使用 10。 |
| `--workspace-root <path>` | 任务的工作区根目录。`connect` 未指定时使用 `~/autowonder_workspaces_<provider>_<executor-id>`。 |
| `--model` / `--reasoning-effort` | 设置模型和推理强度，按执行器的模型配置填写。 |
| `--context-window <n>` | 上下文窗口，可选 `1000000`、`400000`、`260000`。 |
| `--memory-mode <mode>` | `platform`（默认）、`provider-local` 或 `none`。 |
| `--name <name>` | Runtime 名称，默认由 provider 和执行器 ID 组成。 |
| `--debug` | 将 daemon 与 Agent 活动输出到控制台和日志，用于排障。 |

## 4. 典型用法

### 4.1 连接服务端（执行机常驻）

按[接入平台执行器](#2-接入平台执行器)的步骤复制并运行命令。启动配置或部署推荐版本更新后，可在同一入口重新复制。

### 4.2 本地模式（手工提交任务）

如果已经安装所需版本，直接运行上表的 `autowonder` 命令。通过 `npx` 运行时，为这一组操作指定同一个已发布的精确版本。如果需要和某个部署一致，可从该平台生成的启动命令读取包名和版本。以下 Bash 示例适用于 `0.3.33` 及以上，提示输入时填写完整版本号。

```bash
read -r -p '请输入 Runtime 版本号 ' runtime_version && (
  runtime_package="@alicloud/autowonder@${runtime_version:?请指定 Runtime 版本}"
  npx -y "$runtime_package" start &&
    npx -y "$runtime_package" dispatch ./assignment.json &&
    npx -y "$runtime_package" status
)
```

### 4.3 指定 workspace 目录（如 Windows 非 C 盘）

在「启动命令」中打开「编辑完整命令」，添加或修改 `--workspace-root` 并保存。例如，编辑时可添加 `--workspace-root 'D:\autowonder'`。返回启动命令面板，选择目标系统后重新复制。平台会生成适合该系统的完整命令。更多配置操作见[执行器重启指南](executor-restart-controls.md#编辑并在线应用完整启动命令)。

### 4.4 上传需求/设计文档到工单

1. 在已配置 AutoWonder MCP 的客户端调用 `autowonder.workitem_cli_upload_token`，将工单 ID 传给 `id`。返回的 POSIX 和 PowerShell 命令使用部署推荐的 Runtime 版本，并设置有效期为 30 分钟的 `AUTOWONDER_UPLOAD_TOKEN`。
2. 选取与终端匹配的命令，将 `--file` 占位符换成本地路径。如需上传多个文件，每个文件各传一个 `--file` 参数。运行完可用 `autowonder.list_workitem_documents` 确认附件已上传。

下载时，用同一个工单 ID 调用 `autowonder.workitem_cli_download_token`，在返回的命令中填写 `--output-dir`。用 `--file` 选择附件，或移除该参数以下载全部附件。

## 5. 常见问题

### Q1. Windows 执行任务时报 `symlink ... A required privilege is not held by the client`

这个错误可能出现在 Runtime 将仓库投影到工作区时。

```
execute dispatch: project repo XXX into workspace: symlink
C:\...\repos\XXX → ...\workspace\repos\XXX:
A required privilege is not held by the client.
```

Windows 创建目录符号链接需要相应权限。先使用平台推荐的 Runtime 版本重新复制启动命令。新版 Runtime 可用 NTFS junction 完成仓库投影，普通用户也能创建。需要将工作区移到其他盘时，按第 4.3 节设置 `--workspace-root`。

### Q2. 如何设置自定义工作区目录？

按第 4.3 节设置 `--workspace-root`。省略该参数时，`connect` 默认使用用户主目录下的 `autowonder_workspaces_<provider>_<executor-id>`。

### Q3. 启动时报 `No agent CLI detected`

确认执行机的终端能找到所选的 Qoder CLI 或 Qoder CLI CN，再运行对应的启动命令。手工启动 Qoder CLI CN 时显式设置 `--provider qodercn`。

### Q4. 使用 Qoder 系列客户端时报 Node.js 版本错误

将执行机的 Node.js 升级到 20 或更高版本后重新运行启动命令。

### Q5. 启动参数被拒绝

按第 3 节核对参数和取值。如果是平台执行器，核对启动配置后重新复制命令。

### Q6. 如何查看任务执行的详细日志？

在启动命令面板复制 debug 模式命令，运行后查看控制台与日志文件。排查结束后恢复普通启动命令。

## 6. 参考

- [社区版 Runtime 配置](community/runtime-configuration.md)
