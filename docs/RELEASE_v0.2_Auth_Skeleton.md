# VoiceID Online Beta Auth Skeleton v0.2

状态：deployable staging candidate，未批准生产发布

日期：2026-07-21

## 本版本解决的问题

Browser Playground 的 challenge、proof 和 session 全部由不可信客户端生成。v0.2 首次建立独立的服务器信任根：邀请用户以 Passkey 完成注册或登录，只有服务器验证 WebAuthn ceremony 后才签发会话。

## 已实现

- npm workspace：`packages/contracts`、`services/auth-api`、`apps/online-beta`，不搬迁或改写现有静态官网与 Playground。
- TypeBox 运行时契约与 OpenAPI 3.1 输出；Fastify 请求校验直接消费共享 Schema。
- PostgreSQL 扩展式初始迁移：用户、邀请、注册意图、challenge、credential、session、consent 和 allowlist audit event。
- 一次性、5 分钟过期的注册/认证 challenge；数据库只保存带用途域分离的 HMAC-SHA256。
- discoverable Passkey：resident key required、user verification required、attestation none；服务端严格校验 origin、RP ID、challenge 和签名。
- 服务器生成的 32-byte opaque session token；数据库只保存 token HMAC。Cookie 使用 `HttpOnly; SameSite=Strict`，生产强制 `Secure`。
- 15 分钟 idle expiry、8 小时 absolute expiry、当前会话退出与用户全部会话撤销。
- 精确 Origin 检查、全局/认证限速、安全响应头、no-store、liveness/readiness、请求 ID 和不含凭证载荷的审计事件。
- 独立 Vite 页面：邀请兑换、Passkey 注册/登录、会话恢复、退出和 revoke-all；不存在客户端硬编码认证成功态。
- 高风险操作二次确认：现有 Passkey 签发短时、一次性、用途绑定的操作确认；添加/撤销凭证与删除账户不可串用或重放。
- 第二 Passkey 与安全恢复：凭证列表、恢复就绪状态、不同认证器添加；最后一个可用 Passkey 不允许撤销。
- 凭证撤销与账户删除：撤销凭证会撤销全部 session；删除会停用全部凭证/session、撤回 consent，并清空服务端公钥材料与直接 profile 名称。
- 操作员邀请 CLI：随机 code 只输出一次，PostgreSQL 只保存 HMAC、标签、发行人、到期和消费状态。
- Provider-neutral 预发包：固定 Node/Caddy 版本、非 root/read-only 容器、同源反向代理、Secret 文件挂载、数据库 TLS/区域与 trusted proxy fail-closed 契约。

## 自动验证证据

- TypeScript strict typecheck 与 Biome lint。
- 8 项 fail-closed 配置测试、3 项 token/hash 测试。
- PostgreSQL 集成测试验证邀请单次消费、并发 challenge、opaque session、确认用途隔离、最后凭证保护、凭证撤销和删除后公钥清空。
- Playwright + Chrome/Chromium 双虚拟认证器验证注册、第二 Passkey、刷新恢复、重放拒绝、revoke-all、凭证撤销、账户删除和恶意 Origin 拒绝。
- CI 构建 API/Web 镜像，并验证 Caddy 与强制变量/Secret 文件的 Compose 契约。
- npm production/full dependency audit 均为 0 known vulnerabilities（检查日期 2026-07-21）。

## 明确未实现

- 实际生产域名/RP ID、TLS ingress、托管数据库实例、secret manager 资源、KMS、告警接收、备份恢复演练和三环境基础设施。
- 批量/管理后台邀请、账户数据导出、审计保留执行器、邮件或人工恢复（本 Beta 明确不提供后两者）。
- SIWE、ERC-1271、钱包绑定、交易或任何链写入。
- 真实音频、声纹模板、模型推理、VoiceAssessment、PIPIA/DPIA 或生物数据处理。

## Production No-Go

在以下决策与证据全部完成前不得把本版本对真实用户开放：

1. 冻结 Online Beta 的 HTTPS origin、WebAuthn RP ID、Cookie 域、邀请地区与数据区域。
2. 使用环境 secret manager/KMS 注入独立 pepper 与数据库凭据，验证轮换与撤销。
3. 用实际 HTTPS ingress 验证当前同源代理、安全响应头、请求大小/超时和日志 allowlist。
4. 接通审计查询/保留执行器、告警与值班；按预发 Runbook 完成演练并留存证据。
5. 在预发运行依赖/SAST/DAST、ASVS L2 证据映射、备份恢复、迁移和应用回滚演练，并完成独立安全审查。

## 回滚

- 应用回滚：停止 Online Beta Web/Auth API，保持现有 GitHub Pages 官网与 Browser Playground 不变。
- 数据库：`001_initial.sql` 只新增表。测试环境可由受保护的 `_test` reset 命令重建；生产不提供自动 destructive down migration。
- 凭证/会话：停止服务不会把 Passkey 私钥带到服务器；会话可在数据库批量设置 `revoked_at`。正式运维命令需在生产基础设施阶段以双人审批和审计实现。
