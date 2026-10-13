---
description: "通过公司 SSO 中转完成桌面端登录，在账号菜单中显示员工姓名，并将账号 token 作为模型凭证。"
kind: "package-reference"
---

# @deepseek-ai/dsh-hongling-account

[English](README.md) | 中文

本包为企业部署实现 `ctx.deepseekAccount` 接缝，因此账号菜单、欢迎页闸门、左下角身份标签和模型凭证链路都沿用官方消费方，本包不新增任何渲染层界面。由一份 home patch 关闭官方账号行并插入本行，上游文件不被改动。

登录不在此处兑换授权码。已注册的 `redirect_uri` 与 OIDC client secret 都属于公司中转方，因此由中转方在自己的服务端完成 code 兑换，并带 token 以 URL fragment 的形式把浏览器送回本 Host。由于 fragment 不会发送给服务器，中转方将浏览器落在由本包提供的页面上，该页面再把 fragment 回传给 Host。

`startSignIn` 在 `127.0.0.1` 上绑定一个本机回调接收器，并发布 `waiting-browser` 相位，其 `authorizeUrl` 为 `<brokerOrigin>/dsh/login?port=<port>`。桌面端打开该地址，操作员在公司身份提供方完成认证，中转方再把浏览器送回 `http://127.0.0.1:<port>/callback`。接收器只服务本机回环地址，且第一个被接受的 fragment 拥有最终结果：后到的请求会被拒绝，而不是允许其覆盖结果。落地页在回传前先把 fragment 从地址栏清除，因此 token 不会残留在浏览器历史中。

校验是让中转来的 token 可信的环节，因为 token 是经重定向而非直接从签发方到达的。每次登录都强制检查有效期与非空主体标识。仅当配置了 `issuer` 时才核对签发方。只要 `jwksUri` 的密钥可以获取，就会校验签名；获取不到时降级为告警。公司网关会对它代理的每个请求重新校验，因此密钥列表不可达属于可用性问题，而不是伪造身份的手段。

`getProfile` 依据登录时捕获的声明作答，因此员工姓名可立即渲染，也不会因为资料接口不可用而变空。`getBalance` 对已登录账号报告空钱包，且该部署没有奖励活动，因此奖励读取始终为空。`getPlatformSession` 始终为 null，因为该部署不内嵌任何平台文档。

`resolveToken` 仅对 `inferenceOrigin` 返回已存的 `id_token`，且仅限该精确来源。这里刻意不检查有效期：网关才是 token 的权威，让它返回 401 才能使 `rejectToken` 可被观测，进而清除授权、依次发送 `deepseek-account/session-expired` 和 `deepseek-account/signed-out`，并使操作员回到登录闸门。

本提供者不注册授权流程。官方提供者通过 `ctx.authorization.begin()` 提交授权，而该接缝只接受它自己观察到的提交；在该账号 key 上，运行时没有其他消费方读取这一接缝，因此这里直接驱动登录申请，并通过 `ctx.credentials` 写入授权。这去掉了 `NO_FLOW`、`ALREADY_IN_FLIGHT` 和 `NOT_COMMITTED` 三类失败，以及它们所需的交互桩。

## 概述

通过公司 SSO 中转完成桌面端登录，在账号菜单中显示员工姓名，并将账号 token 作为模型凭证。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

本包导出 `HonglingAccount`，它是 `DeepSeekAccount` 的子类，同时作为默认导出。它声明 `static inject = ['credentials']`，并在第二个构造参数接收校验后的部署配置。

`brokerOrigin` 是负责浏览器往返的公司登录中转方。`inferenceOrigin` 是唯一允许接收账号 token 的来源。`jwksUri` 是签发方的密钥列表，仅用于本地签名校验。`usageUrl` 与 `topUpUrl` 是账号菜单的浏览器目的地，必须是绝对 https 地址或本机回环 http 地址，因为桌面端在发布任何账号状态前会先校验这两项。

`issuer` 默认为空，表示接受任意已声明的签发方。信任锚点是签名校验，而不是 `iss` 字符串比对；中转方也可以用自己的签发方重新签发 token，因此固定的默认值会让首次成功登录被拒绝。待实际 `iss` 已知后再设置它。

`verifyLocal` 默认为 true。`callbackPort` 默认为 0，表示自动选择一个空闲的本机端口；`attemptTimeoutMs` 限定包含浏览器往返在内的整个登录申请。

<a id="model-experience"></a>
## 模型体验

无，因为账号凭证只影响 HTTP 认证，不进入模型提示、Session 日志或工具结果。

#### KV Cache effect

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 接收器仅限本机回环，并在运行 Host 的机器上绑定端口，因此该流程支持桌面端，不支持通过网络或远程开发主机访问的 Host；中转方始终把浏览器送回 `127.0.0.1`。虽然会保存中转来的 `refresh_token`，但没有实现刷新流程：一旦 `id_token` 过期，网关返回 401，授权被清除，操作员需重新登录。退出登录仅在本地生效，因为该部署没有暴露撤销接口。签发方默认不做固定，需要更严格校验的部署应在从登录日志读到真实 `iss` 后设置 `issuer`。当 `jwksUri` 不可达时签名校验降级为告警，这使网关成为该次尝试的唯一权威。该部署没有钱包、没有奖励活动、也不内嵌平台文档，因此余额读取报告空钱包、奖励读取始终为空、`getPlatformSession` 始终为 null。超出官方界面之外的品牌定制（例如 logo 或 wordmark）不在本包范围内，因为那些属于客户端侧占位，必须编译进客户端构建，而仅新增的 Host 包无法触及。本包标记为 private 且不会发布，因此必须能从 profile 的 `node_modules` 解析到。Web 端登录路径未经验证；告知中转方的端口绑定在 Host 上，只有浏览器与 Host 为同一台机器时该端口才正确。

<a id="dev-note"></a>
### 开发备注

与官方提供者的两处差异是刻意为之。直接驱动登录申请而不注册授权流程，去掉了三类失败及其所需的交互桩，代价是自行承担提交路径；该接缝本来就只接受它自己观察到的提交，而在该 key 上提供者之外没有消费方读取它。接收 token 而不兑换 code 是由环境决定的：client secret 不由我们持有，且唯一已注册的 `redirect_uri` 属于中转方。

身份是在登录时写入授权而非事后请求，因此左下角标签在离线时也稳定，资料请求也无法延迟它。所依赖的声明为 `name`、`email` 与 `sub`，显示名另有 `preferred_username` 与 `employee_no` 作为兜底。