---
description: "面向侧栏与会话首屏的虹灵 HongLing 品牌填充；供以虹灵而非 DeepSeek Harness 为品牌的部署阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-hongling

[English](README.md) | 中文

## 概述

本包把虹灵 HongLing 标志与字标放进侧栏，并把标志放进空会话首屏，替换外壳或其他品牌包原本注册在那里的内容。它对所有构建 profile 都生效，因此以虹灵为品牌的部署组合本包而不是 `ui-brand-official`。本包不保留运行时状态，也不影响模型请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在以虹灵为品牌的部署中，将本插件挂载到浏览器插件名单。它不需要任何配置，也不需要构建 profile。

### 它如何接管这些 slot

它填充的每个 slot 都是 `single`，优先级最低者渲染。本包以 `-1` 注册，而随包发布的填充停在默认的 `0`，因此虹灵作品无需部署方禁用任何东西就会渲染。想让 DeepSeek Harness 品牌回来的部署应移除本包所在行，而不是重新配置它。

### 再次替换品牌

占据这些 slot 是唯一的组合路径；这里不存在任何品牌配置面。两个品牌包可以同时挂载，各自 slot 中优先级更低者胜出——这正是把显式的 `-1` 写进注册、而不是听凭加载顺序的原因。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

三个填充作为一组声明感知的注册安装：嵌套的 `ctx.slots.inject()` 调用等待全部三个声明方，因此无论本行在它们之前还是之后激活，这组注册都能工作；任一声明消失时三者一并撤回，HMR 期间也不会留下残缺的品牌混合。浏览器半部是 [`src/client/index.ts`](src/client/index.ts)；node 半部是一个空 Loader 座位。

作品放在 [`src/client/brand-artwork.ts`](src/client/brand-artwork.ts)，是经由 `dangerouslySetInnerHTML` 注入的内层 SVG 标记，沿用 `dsh-client-ui-primitives` 中代码文件图标的做法。原有属性拼写得以保留，`class` 规则改写成呈现属性因而不会向整个文档注入样式，渐变与滤镜 id 带上由 `useId()` 派生的实例 id——标志会同时渲染在侧栏与首屏两处，固定 id 会在文档中冲突。墨色跟随 `currentColor`，只有标志的核心镂空保留 `--dsw-alias-bg-base` token。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当品牌面不够用时阅读以下页面。它们从本包占据的 slot 进入渲染这些 slot 的外壳。

- [ui-sidebar](../ui-sidebar/README.zh.md)——声明 `sidebar.brand.mark` 与 `sidebar.brand.name` 并渲染其回退。
- [ui-conversation](../ui-conversation/README.zh.md)——在首屏声明 `conversation.hero.brand.mark`。
- [ui-brand-official](../ui-brand-official/README.zh.md)——被本包遮蔽的随包填充。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md)——浏览器插件行如何加载并注册 slot。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了品牌呈现的供给方式。它们是当前包约束，不是品牌设计对比或任务积压。

- **只有一组填充**——替代呈现属于占据相同 slot 的另一个 Cordis 包。
- **浏览器标题独立**——侧栏字标是 slot 填充，但文档标题是构建环境的事（`DSH_CLIENT_TITLE`）。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

移植自第三方桌面插件 `dsh-brand-hongling`，该插件填充同样三个 slot。移植时去掉了它的 `@deepseek-ai/dsh-client-runtime` inject 条目（该包已不存在）以及它的 `<title>`/`<desc>` 元素——外壳自有的装饰性品牌作品同样不带这些。

</details>

**运行时不变式：** 不发布伴生入口。本包不保留可变状态，三个 slot occupant 通过同一个事务性 effect 安装和释放。
