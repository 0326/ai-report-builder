# ai-report-builder

AI-Native 智能报告搭建系统（搭建态 + 运行态）可运行实现，对应《AI-Native智能报告搭建-搭建态与运行态技术方案》。依赖边界（Agent / DAF 查询 / 沙箱构建）全部 mock。

## 结构

```
packages/
  report-runtime/   @daf/report-runtime  运行时内核 + P0 模块(logger/data/state/event/permission) + schema 渲染器
  materials/        @daf-materials/kit   第一批通用物料：antd + VChart(折线/柱/饼) + VTable(表格)
  report-scripts/   @daf/report-scripts  构建/lint/manifest 派生        （第2轮）
  designtime-sdk/   选区/高亮/Bridge RPC                                （第3-4轮）
  mock-server/      DAF查询 / Agent剧本 / 沙箱构建 全 mock              （第2轮起）
apps/
  host/             搭建工作台：对话面板 + 预览 iframe + 可视编排        （第3轮起）
  template-report/  示例报告工程：report.schema.json + src/blocks        （第2轮）
```

## 运行

要求 Node ≥ 22.18、pnpm ≥ 9。

```bash
pnpm install
pnpm test          # runtime 纯逻辑单测（node:test，零依赖可跑）
pnpm dev           # 第2轮起：启动 mock-server + host 工作台
```

## 进度

- [x] 第1轮：runtime 内核 + P0 模块 + 渲染器 + materials（26 单测通过）
- [ ] 第2轮：template-report + report-scripts + mock-server，浏览器预览示例周报
- [ ] 第3轮：host 工作台 + Bridge + 可视编排 + schema 直更新（≤2s）
- [ ] 第4轮：标注选区 + 布局拖拽 + 物料拖入 + 双 diff
- [ ] 第5轮：mock Agent 对话剧本 + 沙箱真 esbuild 构建 + 时间线撤销
