# ai-report-builder — Claude Code 工作指引

AI-Native 智能报告搭建系统（搭建态 + 运行态）的可运行实现。完整技术方案见 `docs/AI-Native智能报告搭建-搭建态与运行态技术方案.md`，**实现任何一轮前先读对应章节**。所有外部依赖（Agent / DAF 查询 / 沙箱构建）一律 mock。

## 当前进度

- [x] **第 1 轮**：`@daf/report-runtime`（内核 + P0 模块 + 渲染器）、`@daf-materials/kit`（antd + VChart/VTable 首批物料）。26 个单测通过。
- [x] **第 2 轮**：template-report（周报 schema + TrendBlock + 纯函数）、report-scripts（真 esbuild 构建/vendor 共享依赖/声明一致性 lint/manifest 派生/CLI）、mock-server（node:http 零依赖：DAF 查询 + 预览 HTML + 产物静态服务）。浏览器 `pnpm dev` 打开周报，切区域筛选图表联动刷新（声明性，零构建）。34 个单测通过。
- [x] **第 3 轮**：designtime-sdk（Bridge postMessage JSON-RPC：token 握手 + enable/highlight/getSchema/getSelection/onSelect/runtime.action/theme.sync/schema.reload）、host 工作台（Vite+antd 三栏：对话占位/预览 iframe/可视编排三投影 tab + materialMetas 属性面板）、schema 直更新管线（PUT /api/schema 写盘存版本 → Bridge schema.reload → runtime 重建，实测 317ms 零构建）。42 个单测通过。
- [x] **第 4 轮（用户指令重构）**：搭建态切换到 **lowcode-engine**。host = LCE 设计器壳（react16 UMD + Fusion Next + engine-core/ext 全本地化，零 CDN）+ 自研插件（editor-init / setters-registry / save-and-preview / chat-pane 占位）+ 官方 components-pane；物料 assets 从 materialMetas 派生（packages UMD + componentMeta + setters + snippets，`/api/lce/assets`）；schema 经 mergeXFields 保真合并后走原 PUT 直更新管线（浏览器实测：donut 改动落盘 + 全部 x- 字段不丢，17ms 零构建）。45 个单测通过。
- [x] **第 5 轮**：报告工程 = 一个 git 沙箱工作区（`.artifacts/sandbox/project`，与主仓库隔离），一切修改落成 commit、产物按 commit hash 缓存。mock Agent 三剧本（关键词匹配→固定响应+过程卡）：① 空白基线 "做周报" → 全量 schema+TrendBlock 代码 → 真 esbuild 构建；② 选区 "改环形+联动" → 纯 schema patch（对齐附录 A）→ 零构建直更新；③ "加留存漏斗块" → 首版裸 fetch 被 lint 拦截 → 自修复改用 runtime.data 重试（≤2 次）。双 diff（schemaDiff jsondiffpatch 风格 + codeDiff 行级 LCS）、版本时间线（git log）、回滚切产物 URL（秒级零重建）。host 新增 对话/时间线/运行态预览 三面板 + 选区上下文链路，editor-init 冷启动重试容错。浏览器实测：空白→①②③ 端到端跑通，运行态预览渲染含漏斗块的完整周报（真实数据）。55 个单测通过（+10）。

- [x] **第 6 轮（用户指令：去 demo 化）**：对话搭建接入**真实 Claude 模型**（`mock-server/claude.ts` 零依赖 fetch+SSE 调 Messages API：claude-opus-4-8 + adaptive thinking + tool use 多轮循环；`llm-agent.ts` 工具集 read_project/read_file/query_dataset/stage_schema/stage_file/commit_round，lint/构建失败回喂自修复，commit 失败 mixed-reset 保留工作区；凭证走 env 或仓库根 `.env`，无凭证回落剧本 mock，同一 SSE 事件协议）。对话 UI 换**开源方案 @ant-design/x**（apps/chat：React 18 独立页 Bubble/Sender/ThoughtChain，esbuild 构建共享 vendor react 单例，5173 `/chat/` 服务；LCE 宿主 dock iframe 嵌入 + postMessage 回传重载画布/时间线）。**标注修改对齐 Claude Desktop preview 形态**：chat 页右侧预览 iframe 同源直连 designtime Bridge，标注模式点选块（data-node-id）→ 输入框上方选区 chip → 随消息作为上下文发给模型。62 单测通过（+7：SSE 解析/重试/thinking 签名、stub 模型全链路自修复）。浏览器实测：剧本与桥路全链路 ①生成周报→标注选「渠道占比」→②改环形（零构建 round(2)，渠道筛选器上线）。

每轮完成且验收通过后：`git commit`（结构化 message，见下）并 `git push`，再开始下一轮。

## 已确认的实现决策（不要改）

1. 沙箱构建用**真 esbuild**：mock-server 真改 template-report 源码、真增量构建出新 bundle（hash 寻址），不是假延时切 URL。
2. 标注定位第一版**只做块级** `data-node-id`，源码级 `data-loc`（babel 注入）5 轮之后再说。
3. 物料独立成包 `@daf-materials/kit`，模拟"CDN 共享依赖、不打进报告 bundle"语义。
4. 技术栈：运行态 React 18 + TS strict + Vite；图表 @visactor/vchart、表格 @visactor/vtable；mock-server 用 node:http **零依赖**。
5. **Agent 对话必须真模型 + 开源 UI**（2026-06-12 用户指令，第 6 轮起）：对话消息列表基于 @ant-design/x（不自研聊天 UI）；Agent 接真实 Claude（Messages API，零依赖 fetch，凭证 `.env`/env 注入，无凭证才回落剧本）；标注修改参考 Claude Desktop 的 preview 形态（预览点选 DOM 块 → 输入框 chip → 上下文随消息发模型）。剧本 mock 仅作离线回落与测试 stub，不是产品形态。
6. **搭建态基于 lowcode-engine**（2026-06-12 用户指令）：host = LCE 设计器（react16 UMD 壳 + Fusion Next，UMD 全部本地服务零 CDN），自研三栏 UI 已废弃。`report.schema.json` 直接 importSchema 进引擎；导出经 `mergeXFields`（designtime-sdk）做 x- 扩展字段保真，再走 PUT /api/schema 直更新。物料 LCE assets 由 materialMetas 单源派生（`deriveLceAssets`），componentMeta 不手写。AIBlock 画布渲染用设计态占位 UMD，真实渲染走运行态预览（/preview/，React 18 链路不变）。

## 架构铁律（来自方案，违反即返工）

- `report.schema.json` 是结构半权威层：块边界/数据源/联动/筛选必须声明，块内部代码自由。平台语义全部 `x-` 前缀，文件是合法 LCE 页面 schema。
- 双管线分流：声明性修改（props/x-position/物料拖入/声明式联动）**只改 schema、零构建、≤2s**；代码性修改才走 esbuild 构建管线（10s 级）。产物 = bundle.js 与 schema.json 分离部署，schema 运行时 fetch。
- AI 生成代码的唯一世界接口是 `runtime`（block-runtime facade）：取数 `runtime.data.query(dsId)` 仅允许 x-consumes 声明的 dsId；事件 `runtime.event.emit` 仅允许 x-emits 声明集。禁止裸 fetch（lint + 运行期双重拒绝）。
- Agent 修改约定"先 schema 后代码"；一轮修改 = 一个 git commit；撤销 = revert + 按 commit hash 秒级切产物 URL。
- Runtime 内核 < 500 行红线，能力全部模块化（kernel.use）。

## 代码约定

- ESM only，`"type": "module"`；包入口直接指 `src/index.ts`（Vite/esbuild 直接消费 TS 源码，不预构建）。
- **相对导入必须带 `.ts`/`.tsx` 扩展名**（Node 22 type-stripping 直跑测试依赖这一点；tsconfig 已开 `allowImportingTsExtensions`）。
- 不用 enum/namespace（Node type-stripping 不支持）。
- 纯逻辑（无 React）放 `.ts` 并从 `@daf/report-runtime/core` 导出，保证 node:test 零依赖可跑；React 代码放 `.tsx`。
- 测试用 node:test + node:assert，直跑 TS：`pnpm test`。需要 Node ≥ 22.18、pnpm ≥ 9。
- commit message 结构化：`round(N): <intent> | packages: <触及包> | type: <feat|fix|schema|code>`。

## 目录与各包职责

```
packages/report-runtime   内核(kernel.ts) + P0模块(modules/) + 渲染器(renderer/)  [已完成]
packages/materials        @daf-materials/kit 物料 + meta.ts(componentMeta+x-ai)   [已完成]
packages/report-scripts   esbuild 构建 / 声明一致性 lint / manifest 派生          [第2轮]
packages/designtime-sdk   Bridge JSON-RPC / 选区 overlay / mergeXFields x-保真     [已完成]
packages/mock-server      DAF查询 mock / schema直更新 / LCE assets / 产物静态服务  [已完成]
apps/template-report      示例报告工程: report.schema.json + src/blocks           [已完成]
apps/host                 LCE 设计器壳 + 插件(editor-init/setters/save/chat)      [第4轮重构]
```

第 1 轮已交付的关键 API（后续轮直接消费，勿重复造）：
`createReportRuntime(opts)`、`kernel.get<DataRuntime>('data')`、`ReportRenderer({runtime, registry, bundle})`、`buildRegistry(componentsMap, {'@daf-materials/kit': kitExports})`、`makeBlockRuntime`、`materialMetas`。测试 fixture 见 `packages/report-runtime/test/fixtures.ts`（与方案 §2.2 示例 schema 对齐）。

## 各轮实现要点与验收

### 第 2 轮：可运行预览（方案 §2.1/§2.3/§4.1）

- `apps/template-report`：`report.schema.json`（周报示例：KPICard×3 + AIBlock 趋势块 + PieChart 渠道占比 + DataTable 明细 + f_region 筛选 + lk1 联动，直接基于 test/fixtures.ts 扩充）+ `src/blocks/TrendBlock/index.tsx`（自定义块，用 runtime.data 取数、LineChart 渲染、emit drill）+ `src/data/` 纯函数。
- `packages/report-scripts`：`build.ts`（esbuild：entry 注入标准模板，react/物料/runtime 外置为共享依赖，产出 `dist/bundle.{hash}.js` + `schema.{hash}.json` + `manifest.json`）、`lint.ts`（AST 或正则级别即可：裸 fetch/XHR 黑名单、runtime.data.query 的 dsId ∈ x-consumes、emit ∈ x-emits）、`manifest.ts`（从 schema 派生 inputs/outputs/dataSources/permissions）。
- `packages/mock-server`（node:http 零依赖）：
  - `POST /api/daf/query` → 按 datasetId 返回 fixtures 数据集（metric_dau/metric_channel/metric_detail，支持 region 参数过滤，模拟 100-300ms 延迟）
  - `GET /preview/` 预览 HTML（importmap 把 react/物料/runtime 指向 Vite dev 或预构建产物）+ `GET /artifacts/*` 产物静态服务
- 验收：`pnpm dev` 起 mock-server + 预览，浏览器打开能看到周报，切区域筛选图表联动刷新；`pnpm test`、`pnpm lint:report`、`pnpm build:report` 全绿。

### 第 3 轮：host 工作台 + schema 直更新（方案 §3.1/§3.3）

- `packages/designtime-sdk`：Bridge = postMessage JSON-RPC（握手带版本 + token），方法对齐方案 §3.3 表：`designtime.enable/highlight/getSchema/getSelection`、`designtime.onSelect`、`runtime.action`、`theme.sync`。
- `apps/host`（Vite + React + antd）：三栏 = 对话占位 / 预览 iframe / 可视编排面板（结构树、数据源视图、联动图三个 tab，全部是 schema 的投影）。
- schema 直更新管线：host 改 schema → `PUT /api/schema` → mock-server 写盘存新版本 → 通知 iframe（Bridge `schema.reload`）→ runtime 重建并重渲染。属性面板用 materialMetas.configurableProps 生成表单。
- 验收：结构树点选块、属性面板改 donut/标题 → 预览 ≤2s 更新，无构建发生。

### 第 4 轮（已完成，形态调整）：搭建态基于 lowcode-engine

原计划的「布局拖拽 / 物料拖入 / 属性编辑」由 LCE 引擎原生能力承接（components-pane 拖入、setter 面板、画布拖拽）；自研部分收敛为：

- LCE assets 派生（`report-scripts/lce-assets.ts`）+ 物料 UMD 构建（`lce-build.ts`，react 外置 window 全局）。
- x- 扩展字段保真（`designtime-sdk/schema-merge.ts`）：引擎导出丢什么补什么，导出值优先。
- host 插件四件套 + UMD 本地化 vite 中间件（`/lce-vendor/*`）。
- 模拟器画布 iframe 复用宿主 React16（引擎默认 environment），物料 UMD + Next 经 assets packages 注入。

未迁移项（并入第 5 轮）：标注选区上下文包（designtime-sdk overlay 走真实预览链路）、双 diff。

### 第 5 轮：mock Agent + 构建管线 + 双 diff + 撤销（方案 §3.4 链路一/§3.5）

- Agent 剧本（`mock-server/fixtures/agent-scripts/`）：意图关键词匹配 → 固定响应。至少三个剧本：① "做周报…" → 全量 schema + TrendBlock 代码 → 走构建；② 选区+"改成环形图，点击渠道联动趋势" → 纯 schema patch（对齐方案附录 A 的 diff）→ 直更新；③ "加一个留存漏斗块" → schema + 新块代码 → 增量构建。响应含结构化过程卡（数据集/物料选用理由/变更摘要）。
- 沙箱构建 mock：`POST /api/sandbox/build` → 真改 template-report 源码 → 调 report-scripts lint+esbuild → 新 hash 产物 → 返回新 URL，host 切 iframe。失败回喂剧本自修复（≤2 次）。
- 每轮修改 git commit（用 isomorphic-git 或直接 child_process git）；时间线 UI：每轮 intent/diff 摘要，点任意节点回滚 = 切该 commit 产物 URL。
- 验收：端到端演示完整跑通——对话生成 → 标注修改 → 拖拽 → 双 diff → 撤销回滚。

## 命令

```bash
pnpm install
pnpm test            # 全部单测（node:test 直跑 TS，零依赖）
pnpm dev             # mock-server(5173) + host 工作台(5174)；预览直连 5173/preview/
pnpm dev:server      # 只起 mock-server（注意：读 MOCK_PORT 不读 PORT，避免启动器注入冲突）
pnpm lint:report     # 对 template-report 跑声明一致性 lint
pnpm build:report    # esbuild 构建报告产物（dist/）
```
