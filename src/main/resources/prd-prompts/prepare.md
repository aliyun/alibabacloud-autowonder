当前阶段是准备前端工程。只操作任务提供的独立工程，不要打开外部仓库或启动任何服务。

1. 核对当前分支和基线提交，读取仓库的 AGENTS.md、uxer.config.json、工程说明和包清单。已有 uxer.config.json 也要检查真实启动入口及其 Inspector 接入。
2. 优先复用已有且可用的 UXer/Vite 工程。优先尊重用户选定的目录；没有指定目录时，只有一个有证据的合适前端才自动选用。多个候选时用文字向用户说明差异及推荐，等待答复。
3. 在已有前端补齐预览配置。普通 Vite 应用使用原 Vite 配置，补齐 dev:autowonder、autowonder 模式、预览 base 和 import.meta.env.BASE_URL，保留业务代理与普通开发、生产构建行为。缺少 uxer.config.json 时，按实际工程补齐配置，demo.start 写入真实启动命令。若沿用仓库自定义托管启动，核对 demo.start 和 autowonder.managedVite，Vite 接收 PORT、VITE_BASE 和 AUTOWONDER_VITE_PLUGIN。托管预览的 Vite 仅监听 127.0.0.1，使用 PORT 作为首选端口并允许端口顺延。报告仓库根目录以让执行器使用根配置。
4. 未接入的前端使用公开包 @uxerjs/universal-inspector@0.3.0，在实际预览入口初始化圈选 Inspector。React 工程可从 @uxerjs/universal-inspector/react 接入 InspectProvider，其他前端可使用 installInspector。PRD 预览只使用公开可安装的 Inspector，不新增私有 Inspector 依赖。已有经平台托管的预览可复用平台加载的新版 Inspector，明确记录由平台加载。核对实际入口，只初始化一次。
5. 没有合适前端时，将已校验的 .git/autowonder-template 内的模板文件复制到空目录。使用用户指定的空目录，或使用 frontend（如存在且非空则使用 design-frontend；仍非空时请用户选目录）。不得覆盖文件、复制 .git、依赖、构建产物或本地凭据。可保留不含凭据的 .env.example。
6. 核对 Vite 依赖和启动方式。若修改了依赖声明，使用工程原有包管理器同步锁文件，优先使用仅更新锁文件的命令。执行器会按锁文件安装依赖，锁文件未能同步时先报告阻塞原因。上报 PREPARED 前，核对实际启动命令、Inspector 的加载位置及版本、包清单和锁文件是否一致，并将结果写在准备说明中。无法确认 Inspector 从哪里加载时，先报告具体阻塞。完成核对后，调用 autowonder.report_prd_design_runtime，status=PREPARED、route=/、sequence=1，directory 填相对会话的实际应用目录。此阶段只核对工程配置与依赖，预览是否真的就绪、能否圈选，由启动后的实测确认。完整依赖安装、预览启动及后续派发由执行器和平台完成。此阶段不调用文档上报或提交 Git。
