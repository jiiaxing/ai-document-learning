# AI PDF Tutor Standalone

这是从 VS Code 插件核心能力中拆出来的独立 PDF 阅读与 AI 辅助学习应用。它可以在浏览器中打开本地 PDF、选中文本后自动翻译和讲解，并在右侧保留可追问的 AI 会话。

## 启动

```powershell
npm.cmd run compile
npm.cmd start
```

默认地址：

```text
http://127.0.0.1:5178
```

如果 `5178` 已被占用，应用会自动尝试后续端口，并在终端和 `logs/app.log` 中输出实际 URL，例如 `http://127.0.0.1:5179`。

如果工作区根目录里有 PDF，例如 `test.pdf`，页面会在“工作区 PDF”下拉框中列出，可以直接打开。

## 页面功能

- 顶部：配置 Provider、协议、Endpoint、Model、API Key、高级请求参数和提示词模板。
- 左侧：勾选“选区后自动翻译”后，选中 PDF 文本会自动流式翻译，并按 Markdown 展示结构化结果。
- 中间：PDF 阅读器，支持打开文件、打开工作区 PDF、按钮翻页、滚轮页边界翻页、方向键翻页和缩放；默认缩放会记住上次使用的比例，首次打开约为 190%。
- 批注：打开“批注模式”后，选中文本可以添加高亮或嵌入式文字笔记；没有选区时点“笔记”会进入文本框放置模式，可在 PDF 任意空白处点击放置，随后直接输入文字。编辑时文本框支持拖动左侧手柄移动、拖拽右下角调整长宽，并可用 `A-` / `A+` 调整字号；输入框失焦后会隐藏边框，只保留嵌入的文字，单击文字可重新编辑，也可以用“删除笔记”删除当前单条笔记。打开“线条模式”后可在页面上拖动绘制自由线条，打开“橡皮”后点击线条可删除。批注保存在浏览器本地，不会改写原 PDF 文件。
- 右侧：AI 讲解会话，勾选“选区后自动讲解”后会自动解释选区，也可以继续追问；会话区有独立滚动条，触发新讲解时自动跳到新回答开头。
- 底部：开发者日志面板，展示浏览器端关键流程，方便对照 `logs/app.log` 排错。

## 配置

页面点击“保存设置”后会写入本地文件：

```text
ai-tutor.config.json
```

这个文件已加入 `.gitignore`，不会被提交。API Key 不会通过 `/api/settings` 回显到浏览器；前端也只会提交本次手动输入过的 Key，避免浏览器旧表单值误传。

也可以参考示例文件：

```text
ai-tutor.config.example.json
```

OpenAI-compatible 示例：

```json
{
  "provider": {
    "kind": "openaiCompatible",
    "protocol": "openai",
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-4o-mini",
    "apiKey": "YOUR_API_KEY",
    "apiKeyHeader": "Authorization",
    "apiKeyPrefix": "Bearer "
  },
  "systemPrompt": "你是计算机课程 PDF 助教。回答必须完全基于用户提供的 PDF 选区与周围页面上下文，不要编造外部资料。默认使用中英双语：中文解释为主，关键术语保留英文原词。"
}
```

OpenAI-compatible 的 Endpoint 可以填完整的 `/v1/chat/completions`，也可以只填到 `/v1`，应用会自动补全为 Chat Completions 地址。`Key Prefix` 填 `Bearer` 或 `Bearer ` 都可以，保存后会按请求需要保留空格。

提示词设置在页面“高级”区域中，包括：

- 系统提示词
- 讲解提示词
- 翻译提示词
- 追问提示词

默认讲解提示词会把 PDF 当前页及相邻页文本作为隐藏上下文发送给模型，模型只解释用户选区或追问内容；默认翻译提示词会输出整段翻译、关键词汇对照和关键单词讲解。页面上的自动翻译/自动讲解开关、批注模式、线条模式、缩放比例等阅读偏好会保存在浏览器本地，下次重新打开仍会保留。

## 日志

真实运行日志写入：

```text
logs/app.log
```

常见事件包括：

- `app.start`
- `client.app.settings.loaded`
- `client.workspace_pdf.open.start`
- `client.pdf.open.done`
- `client.selection.trigger`
- `client.translate.fetch.start`
- `client.explain.fetch.start`
- `client.pdf.context.built`
- `client.pdf.page.turn`
- `client.annotation.add`
- `client.annotation.note.add_box`
- `client.annotation.note.font`
- `client.annotation.note.delete`
- `client.annotation.line.add`
- `client.annotation.line.erase`
- `provider.mock.chunk` 或 `provider.http.chunk`
- `explain.response.done`

## 测试

```powershell
npm.cmd test
npm.cmd run lint
node --check public\app.js
```

测试会覆盖：选择触发去抖、设置接口不回显 Key、本地 PDF.js 资源、本地 PDF 打开、PDF 上下文注入、Markdown 渲染、阅读偏好记忆、滚轮/键盘翻页、PDF 批注脚本、流式讲解、流式翻译和浏览器端关键脚本检查。
