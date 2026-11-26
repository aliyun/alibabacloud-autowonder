# 本机产品与交互设计

PRD 设计页右侧通过平台主域子路径 `/design-preview/<绑定标识>/` 访问执行器 Vite，由[专用预览中转](prd-preview-relay.md)和执行器主动建立的 WSS 转发。分享链接打开实时预览，设计交付则归档经评审的 Git 提交和需求说明。参见[设计分享与评论](prd-design-review.md)。

## 工程与模板

需要评审交付时，先在空间仓库中配置「设计基线分支」，然后在工单的 PRD 设计中选择该仓库、小队和数字员工。可指定前端目录。平台确定设计分支 `autowonder-design/<需求ID>-<来源摘要>`，执行器按指定基线检出到该分支，工程位于会话下的 `design-demo/<需求ID>/<来源摘要>`。已有前端复用工程并按需补齐接入配置。没有前端工程时，可在该仓库的空目录中使用模板。再次进入会恢复该设计工程和预览。

只做原型预览时，也可以用「新建项目」直接从模板开始，或使用未配置设计基线的仓库。评审后推送到共享仓库需要已配置基线的仓库。

模板存放在后端资源 `templates/uxer-fe-template.zip`。执行器实际派发时获得有效期一小时的下载链接和 SHA-256，用于核对收到的模板，与 PRD 附件一样通过对象存储下载。链接不写入历史运行状态。

模板维护后，在 Autowonder 仓库执行：

```sh
python3 scripts/package-design-template.py --help
```

按脚本参数指定获准使用的模板提交。社区内置模板使用公开的 Universal Inspector，首页显示「组件已经备好，直接开始设计。」。

## 工单启动与重试

平台在确认时校验小队、员工和执行器在线状态。设计员工需要目标仓库读写权限，澄清员工只需读权限。

平台按新版执行器的协议下发 PRD 设计任务。执行器检出工程和下载固定模板后，先由数字员工检查已有工程、确认应用目录及预览启动方式。候选不明确时在设计对话中补充信息。员工上报 `PREPARED` 且该轮执行结束后，执行器安装依赖并启动预览。预览就绪后，平台自动将工单需求和澄清结果交给员工开始设计。失败后可在设计页重试，复用会话和已有工作目录。

阶段提示词在 [PRD 提示词目录](../src/main/resources/prd-prompts/) 纳入 Git 维护。`prepare.md` 负责工程探查、接入和目录确认，`design.md` 负责迭代原型和需求说明，`handoff.md` 负责收尾约束。调整协议或阶段职责时更新 `PrdPrompts.VERSION`，并与应用和执行器的相应改动一起验证。

提交评审时，执行器将代码和同一份 Markdown 推送到仓库的 `autowonder-review/` 命名空间，回读分支确认推送的提交号，并将结果报告给平台。平台保存仓库地址、该次评审的远端分支、提交号和文档，通知指定评审人。通过后，平台归档同一份 Markdown 到「需求与设计」附件，并使用已保存的分支和提交号交付。交付摘要列在该卡片末尾，包含仓库、分支、提交、附件和需求澄清入口。交付可在原执行器离线时完成。

执行器的 Git 身份需要能读取设计基线并创建 `autowonder-review/` 下的评审分支。`autowonder.prd.git-hosts` 配置允许的 Git 主机。历史设计仍可查看原有原型和需求说明。进入新交付流程需要已绑定可校验的交付仓库工程。

## 历史设计的协作启动与状态报告

执行器使用 `pnpm dev:autowonder`（或 `npm run dev:autowonder`）启动。该命令通过 Vite 的 `autowonder` 模式启用协作启动配置。内置社区模板使用公共 Inspector。默认端口 5173，协作模式允许 Vite 顺延端口。检查 HTTP 就绪后必须报告实际端口，不能假设服务总在 5173。

任务携带的会话 MCP 凭据可调用 `autowonder.report_prd_design_runtime`：

```json
{"status":"READY","port":5173,"route":"/","directory":"design-demo/10000/example","sequence":2}
```

状态支持 `STARTING`、`READY`、`UPDATED`、`FAILED`，失败可带 `error`。每次执行尝试的 `sequence` 从 1 严格递增，重试同一报告复用序号。旧执行器、旧轮次和旧执行尝试不能覆盖当前状态。服务跨对话轮次保留，仅操作确认属于当前需求的进程。

若 provider 未将 MCP 工具挂载，任务会指明当前轮次的 `.autowonder/turns/<turnId>/bootstrap/mcp.json`，可以使用其中名为 `autowonder` 的会话连接完成 MCP 初始化和工具调用。该配置由执行器注入，不应打印或复制其中的认证信息；不得搜索个人凭据或改用执行器令牌。

平台按需求与当前 Agent 读取 `/api/workitems/{workitemId}/prd/runtime?agentId=...`。正常修改由 Vite HMR 更新；执行器每次修改完成还要报告 `UPDATED`，平台以递增版本刷新当前浏览器路由，为 HMR 不可用提供兜底。运行状态表由社区迁移 [V122](migration/V122__prd_preview_and_review.sql) 提供。

## 圈选评论

页面收到 inspector 就绪消息后启用圈选。选中元素并填写意见后，平台先保存评论，再将引用加入对话输入区；负责人可移除引用、补充说明并显式发送。发送时冻结正文、元素摘要、当前路径、查询参数、hash 和设计版本，下一轮执行器通过同一对话获得意见。分享页只保存评审意见。消息接收校验当前 iframe 与平台来源，地址栏只允许当前预览绑定子路径内导航。显示和保存的业务路由不包含代理前缀。Vite 使用任务下发的 `--base /design-preview/<绑定标识>/`，路由器的 basename 使用 `import.meta.env.BASE_URL`。未配置隧道时明确提示，不回退 localhost。
