---
description: "虹灵企业 OIDC 单点登录：操作者在浏览器中向市场后端完成认证，Host 半边保存 id_token，Web 客户端显示账号设置分区与登录浮层。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-hongling-auth

[English](README.md) | 中文

## Summary

挂载本包即可让操作者通过企业 SSO 登录虹灵部署，而不使用自带的 DeepSeek Platform 账号页。Web 客户端提供“账号”设置分区和登录浮层；Host 半边打开回环接收器，把操作者送到市场后端，校验返回的 id_token，并将其保存在 harness home 下模式为 0600 的文件中，因此浏览器始终拿不到令牌。其他插件的 Host 半边通过 `ctx.honglingAuth` 读取当前令牌。把 `backendUrl` 指向另一个市场，并且只在开发环境启用 `devAuth`。

## Table of Contents

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发者注记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

挂载一行插件，操作者即可在“设置 ▸ 账号”中登录。

### 何时选择

当操作者通过虹灵的企业身份提供方登录时选择本包。自带的账号分区登录的是 DeepSeek Platform；本包以优先级 `-1` 占用同一个 `settings.section` id，因此两者同时组合时虹灵面板胜出。没有企业身份提供方时请去掉这一行：包内其余部分单独使用没有价值。

### 最小配置

```yaml
- id: hongling-auth
  name: '@deepseek-ai/dsh-client-hongling-auth'
  config:
    backendUrl: https://agent-sphere.changhong.com
    verifyLocal: true
    devAuth: false
```

| Field | Default | Meaning |
|---|---|---|
| `backendUrl` | `https://agent-sphere.changhong.com` | 市场后端地址，不含 `/api/v1` 后缀。 |
| `redirectPort` | 空闲端口 | 供 SSH 端口转发场景固定回环端口。 |
| `verifyLocal` | `true` | 使用签发方的 JWKS 校验 id_token 签名。 |
| `devAuth` | `false` | 开放 `auth.devLogin`，对应后端的 `AUTH_MODE=dev` 注入。 |

配置块省略某项时，由三个环境变量补齐：`HONGLING_DSH_BACKEND_URL`、`HONGLING_DSH_OIDC_REDIRECT_PORT` 和 `HONGLING_DSH_OIDC_VERIFY_LOCAL`。超出 1024–65535 的固定端口会被忽略而不是报错，因此错误的环境值只会退化为随机端口。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-client-hongling-auth)是全部可接受字段的完整来源。

### 操作者看到的内容

分区显示登录按钮、含角色与令牌过期时间的已登录资料，以及退出登录操作。发起登录会打开系统浏览器并跳转到市场中转；面板随后依次报告四个阶段——等待浏览器、接收回调、校验中、已登录——并每秒轮询一次进度行。没有浏览器的宿主仍会显示带复制按钮的登录链接，操作者可以手动完成流程。取消，或五分钟超时，都会关闭回环接收器并让面板回到静止状态。页面事件 `hongling-auth:request-login` 可以从客户端任意位置以浮层形式打开同一面板，登录成功后该浮层会在 600 ms 后自动关闭。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 —— 点击展开</summary>

两半之间从不共享令牌，这正是拆分的设计意图：Host 半边持有凭证，浏览器半边只负责呈现。唯一的 RPC 通道 `/hongling-auth` 承载六个端点——状态、登录、进度、取消、退出登录和开发注入——且没有任何返回值携带令牌。其他插件读取 `ctx.honglingAuth.getToken()`，而不自行开启通道；当令牌进入 60 秒续期窗口时运行时先续期，因此宿主侧调用方不会在请求中途遇到过期令牌。

登录流程只走回环。后端中转把操作者带回 `http://127.0.0.1:<port>/callback`，令牌放在 URL 片段里，而浏览器从不把片段发给服务器；被服务的页面自行读取 `location.hash`、清除它，再把键值对 POST 到同源的 `/complete`。监听器只绑定 IPv4 回环，接受一次完成或取消，然后关闭。后端是机密型 OIDC 客户端，因此本插件不持有客户端密钥：它通过后端的 `/dsh/refresh` 续期，而不自行交换授权码，并且 `invalid_grant` 会清除登录状态而不是重试。

校验分两层。过期时间始终强制检查；当无法访问签发方时，对签发方 JWKS 的签名校验降级为警告，因为后端中转才是最终权威。令牌文件位于 `<harness home>/hongling-auth/auth.json`，在 0700 目录中以 0600 模式保存。续期响应若不含 `exp`，则退回使用随附的 `expires_in` 有效期。

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host 插件：配置、RPC 通道、`ctx.honglingAuth`、挂载时恢复登录态。 |
| [`src/runtime.ts`](src/runtime.ts) | 登录状态、续期往返、端点分发。 |
| [`src/login-session.ts`](src/login-session.ts) | 回环接收器及其提供的回调页面。 |
| [`src/jwt.ts`](src/jwt.ts) | 解码、声明投影、JWKS 校验、令牌组装。 |
| [`src/config.ts`](src/config.ts) | 配置解析、环境变量回退、磁盘位置。 |
| [`src/client/index.ts`](src/client/index.ts) | 两处槽位注册与登录请求桥。 |
| [`src/client/auth-panel.ts`](src/client/auth-panel.ts) | 两个界面共用的面板状态与动作。 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [ui-settings-account](../ui-settings-account/README.zh.md) —— 被本包遮蔽的自带账号分区。
- [ui-settings](../ui-settings/README.zh.md) —— 声明 `settings.section`。
- [ui-layout](../ui-layout/README.zh.md) —— 声明 `shell.overlay`。
- [connection](../connection/README.zh.md) —— RPC 通道所依托的已认证传输。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md) —— 浏览器插件行如何加载并注册槽位。

-----

<a id="model-experience"></a>
## 模型体验

无，因为账号授权不注册任何模型上下文或工具；凭证只影响 HTTP 认证。

#### KV Cache effect

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了企业部署的边界。它们是当前的包约束，既不是与 Platform 登录的对比，也不是任务清单。

- **同时只支持一个后端和一次登录** —— 接收器只服务一次进行中的登录，一个配置块也只指定一个市场。第二个市场需要第二行组合配置及其自己的通道。
- **令牌文件未加密** —— harness home 下的 0600 模式就是全部存储边界，因此能读取该账号的任何进程都能读到令牌。
- **无法访问 JWKS 不会导致登录失败** —— 签名校验在过期检查之后降级为警告，因此中转被攻破不会被本地发现。
- **`devAuth` 是配置开关而非角色校验** —— 任何 RPC 调用方都能为任意用户名签发登录，因此只适用于开发组合。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

从 HongLingElectron 项目的第三方桌面插件 `hongling-plugins/hongling-auth` 移植而来。移植保留了该插件的配置面——`backendUrl`、`redirectPort`、`verifyLocal`、`devAuth`——以及它的回环流程，并替换了呈现部分：插件自有的 CSS 变量与硬编码紫色改为共享的 `--dsw-alias-*` 令牌，独立的账号页则改为以优先级 `-1` 遮蔽自带分区的分区，而不再新增第二个设置项。

</details>

**运行时不变式：** 不发布 companion。插件不维护可供检查的独立运行时关系：令牌新鲜度、单次进行中的接收器和服务生命周期都由本包的 Host 规格直接断言。