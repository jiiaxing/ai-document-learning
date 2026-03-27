# AI 课件助教技术选型与实现方案

## 1. 文档定位

本文档描述技术实现方案（How），包括：

- 架构分层
- 状态机与事件流
- PDF 触发制实现
- Provider 选型与协议适配
- 取消机制与并发控制
- 性能与可观测性

---

## 2. 技术选型

## 2.1 平台与语言

- VS Code Extension API
- TypeScript（严格模式）
- Webview（侧边栏 + 自建 PDF 视图）

## 2.2 PDF 方案选型

- 选型：PDF.js（在 Webview 内渲染 + textLayer 选区）
- 原因：可直接监听 `mouseup` 与 `window.getSelection()`，满足“触发制”语义

## 2.3 模型接入选型

- Provider 端口抽象：`AIProvider`
- 默认：Copilot（文本）
- 可切：OpenAI 兼容接口（含国产网关）
- 图片兜底：OCR（tesseract.js）

## 2.4 数学渲染

- KaTeX（Webview）

---

## 3. 分层架构

```text
Trigger Layer
  ├─ TextSelectionTrigger
  ├─ PdfSelectionTrigger (PDF.js mouseup)
  └─ ManualTrigger
        │
        ▼
Orchestrator Layer
  ├─ StateMachine
  ├─ RequestGate
  └─ CancellationGuard
        │
        ▼
Provider Layer
  ├─ CopilotProvider
  ├─ OpenAICompatibleProvider
  └─ OcrService
        │
        ▼
UI Layer
  ├─ Sidebar Webview
  └─ Pdf Tutor Webview
```

职责边界：

- Trigger：只上报事件，不发请求
- Orchestrator：唯一请求入口
- Provider：只负责外部通信
- UI：只负责展示和输入

---

## 4. 状态机设计

## 4.1 状态

- `idle`
- `running`
- `cancelling`
- `cancelled`
- `cooldown`（自动触发冷却）

## 4.2 事件

- `AUTO_SELECTION_COMMIT`
- `MANUAL_ASK`
- `REQUEST_START`
- `REQUEST_SUCCESS`
- `REQUEST_ERROR`
- `CANCEL_CLICK`
- `CANCEL_DONE`
- `COOLDOWN_EXPIRE`

## 4.3 关键规则

- 任意回包落地前必须满足：
  - `requestId === activeRequestId`
  - 未取消
- `cancelled` 状态自动触发默认拒绝，手动触发可解锁

---

## 5. PDF 触发制实现方案（核心）

目标语义：左键松开且有最终选区文本时触发。

实现步骤：

1. 在自建 PDF Webview 中渲染 textLayer
2. 监听 `mouseup`
3. 读取 `window.getSelection().toString()`
4. 做最小长度与去重判断
5. 上报 `selection` 事件给扩展主线程
6. Orchestrator 统一发起请求

注意：

- 不走轮询
- 仅保留 50~120ms 微防抖，防止双击抖动
- 语义上“松开即触发”

---

## 6. 取消机制实现

取消必须是三层：

1. `CancellationTokenSource.cancel()`
2. `activeRequestId` 前移（旧请求失效）
3. 结果落地前做 requestId 校验（迟到回包丢弃）

对于 OCR：

- 取消时终止 OCR worker

---

## 7. Provider 适配策略

## 7.1 接口

```ts
interface AIProvider {
  ask(messages, token): Promise<string>
  askVision?(prompt, imageDataUrl, token): Promise<string>
}
```

## 7.2 OpenAI 兼容层

需要支持：

- 自定义 endpoint
- 自定义 auth header / prefix
- extra headers / extra body
- response path 配置
- 文本与视觉 endpoint/model 分离

## 7.3 视觉回退

- `visionMode=auto`：视觉接口优先
- 失败可回退 OCR（可配置开关）

---

## 8. 配置治理

统一在配置模块读取并校验：

- 类型校验
- 默认值合并
- 边界值修正
- 错误提示归一化

配置分组：

- 触发：selection / pdf / cooldown
- 模型：provider / protocol / endpoint / model
- 视觉：visionMode / OCR fallback
- 展示：responseStyle / math render

---

## 9. 可观测性与调试

建议新增调试开关：

- 当前状态机状态
- 最近一次触发源
- requestId / activeRequestId
- 取消原因与耗时
- PDF 触发事件时间戳

用于定位“误触发、慢触发、取消失效”。

---

## 10. 风险与应对

1) PDF.js 文本层与原始排版差异
- 应对：提供“原文片段预览”确认

2) 供应商 API 结构差异大
- 应对：响应路径、headers、body 全可配置

3) 并发竞态回归
- 应对：状态机单元测试 + requestId 守卫测试

---

## 11. 里程碑（技术视角）

- M1：完成触发层拆分（含 PdfSelectionTrigger）
- M2：完成状态机与取消守卫重构
- M3：完成 Provider 适配层与配置校验统一
- M4：完成 UI 分层与调试面板

每个里程碑必须通过对应测试后再进入下一阶段。
