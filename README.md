# AI 课件助教（pdf-reader）

在 VS Code 中对 PDF / 文本内容进行 AI 讲解与追问，面向计算机课程学习场景。

## 主要功能

- 选中文本后自动讲解（支持防抖、冷却、最小长度阈值）
- PDF 选区自动捕获并讲解（剪贴板稳态检测，降低闪烁误触发）
- 图片讲解：优先视觉模型，失败时可自动回退 OCR + 文本模型
- 侧边栏对话：可追问、可取消当前响应、可清空历史
- 支持 `Copilot` 与兼容 API（含 OpenAI / Anthropic 协议）

## 快速使用

1. 打开命令面板，执行“AI 助教：打开侧边栏”。
2. 在编辑器或 PDF 中选择内容，自动触发讲解，或手动执行命令：
	- AI 助教：讲解所选内容
	- AI 助教：讲解剪贴板文本
	- AI 助教：讲解图片

## 配置说明（节选）

- `aiTutor.provider`: `copilot` / `openaiCompatible`
- `aiTutor.openai.protocol`: `openai` / `anthropic`
- `aiTutor.openai.endpoint`: 接口地址
- `aiTutor.openai.model`: 文本模型
- `aiTutor.openai.visionModel`: 视觉模型（可选）
- `aiTutor.openai.responseTextPath`: 响应文本路径
- `aiTutor.imageExplainFallbackToOcr`: 视觉失败时是否回退 OCR

## 开发与打包

- 编译：`npm run compile`
- 打包：`npx @vscode/vsce package`
- 安装 VSIX：在 VS Code 扩展面板选择“Install from VSIX...”

## 隐私提示

请避免在仓库中提交明文 API Key。推荐使用环境变量（如 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`）。
