---
description: "dsh Web 客户端的审计空间面板：项目选择器、宽表选择器，以及驱动真实 Agent 会话的聊天区。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-audit-space

[English](README.md) | 中文

## 概述

审计空间面板是 dsh Web 客户端内的一个自定义 UI 界面，参照审计工作台产品原型构建。它注册一个新的主栏面板（「审计空间」）及其侧栏入口，从模拟数据渲染项目选择器与宽表选择器；而本包的要点在于复用 Harness 真实的聊天能力——聊天区通过标准的 `ctx.sessions` 服务创建一个真正的 Agent 会话，并把其事件流式渲染进对话记录。

这是「自定义面板 + 自定义布局 + 复用聊天」方向的最小验证切片；它有意把产品模拟数据留在客户端包内，只把聊天接到真实机制上。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在侧栏打开 **审计空间** 入口。页面包含：

1. **项目选择器** —— 原型中的七个审计项目以彩色 chip 呈现，可按名称筛选。
2. **宽表选择器** —— 原型中的宽表，每张标注是否已授权，并带有公司数量与简短说明；可任意勾选子集。
3. **聊天区** —— 真正生效的部分。输入消息并发送；首次发送会创建并打开一个 Host 会话（`ctx.sessions.create` → `retain`），后续发送则提示同一个绑定，对话记录随着事件到达渲染用户气泡、流式助手文本与工具调用行。

「保存配置」仅为外观（弹出一条提示）；「新会话」会释放已持有的会话，并在下次发送时开启一个全新会话。

<a id="understand-the-implementation"></a>
## 理解实现

- [src/client/index.ts](src/client/index.ts) —— Cordis 的 `apply`：注册 `auditSpace` 词典、`main` 键控插槽（`PANEL_ID = 'audit-space'`）以及 `sidebar.panellist` 入口，与 `ui-plugin-manager` 完全一致。
- [src/client/audit-space-controller.ts](src/client/audit-space-controller.ts) —— apply 世界的会话驱动器。`send()` 惰性创建/持有 Session、提示它，并把 `binding.eventSource` 的窗口条目折叠成对话记录快照。该折叠是幂等的：它记录已处理的最后一个持久 `seq` 与瞬态 `seq`，因此重复读取窗口绝不会重复行；`assistant/live-chunk` 的瞬态文本累积到 `streaming` 缓冲区，由落定的 `assistant/message` 事件清空。
- [src/client/audit-space-store.ts](src/client/audit-space-store.ts) —— 纯展示 store（项目、已选宽表、草稿、对话记录）。组件通过 `props.actions.*` 写入；只有 `send`/`newSession` 走 inject face，因为它们需要 apply 闭包。
- [src/client/AuditSpacePage.tsx](src/client/AuditSpacePage.tsx) —— 页面组件；五份共享 props、经 `MarkdownText` 渲染的 Markdown 助手气泡、自动滚动的对话记录。
- [src/client/mock-data.ts](src/client/mock-data.ts) —— 原型中的宽表与项目。

<a id="model-experience"></a>
## 模型体验

间接地，经由聊天区所驱动的原生 Agent 会话——它拥有每一轮的提示词、工具集与对话记录；本面板只渲染该会话的事件，自身不贡献任何面向模型的文本。

#### KV Cache effect

本面板不在请求前缀中注册任何内容，因此自身绝不会使复用失效。每个聊天的 Session 遵循会话包常规的追加式增长，而「新会话」会开启一条独立的请求链，与前一条不共享任何可复用前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 项目/宽表数据为模拟数据；原型中的字段级配置与数据范围公司池尚未渲染。
- 每次面板挂载共享单个 Session；没有按项目的会话历史、持久化或侧栏列表。
- 暂无与语言无关的测试；本包是一个验证切片。

<a id="dev-note"></a>
### 开发备注

依据[新增包检查清单](../../../docs/cookbook/adding-a-package.zh.md)与 `ui-plugin-manager` 的注册模式构建。在探测运行中的 `dsh web` 服务前，先用 `pnpm --filter @deepseek-ai/dsh-client-ui-audit-space bundle` 重新构建。

**Runtime invariant：** 未发布任何伴生模块。本面板不拥有任何提交事件契约可供观察：它把原生 Session 自身的事件折叠为对话记录快照，不维护任何独立的投影。