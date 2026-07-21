# VoiceID Online Beta 预发运行手册

状态：可构建的 provider-neutral staging candidate；未批准向真实用户开放

日期：2026-07-21

## 1. 当前发布单元

预发单元由两个容器和一个外部托管 PostgreSQL 组成：

- `web`：Caddy 只在容器内监听 `8080`，提供 Vite 静态客户端并把 `/v1/*`、`/healthz`、`/readyz`、`/openapi.json` 反向代理到 Auth API。
- `auth-api`：非 root Node.js 进程，只连接 PostgreSQL，不暴露宿主端口；启动时按顺序执行不可重复的增量迁移。
- PostgreSQL：必须是已批准区域的托管实例，连接串必须启用 `sslmode=verify-full`。Compose 不创建本地数据库，也不持久化数据库卷。

公网 TLS 必须终止在平台入口、负载均衡器或受管 ingress；它把完整请求转发到 `web:8080`。浏览器看到的 Web、API、Cookie 和 WebAuthn ceremony 必须属于同一个 `EXPECTED_ORIGIN`。

## 2. 部署前强制决策

下列字段没有真实负责人和证据时为 No-Go：

| 决策 | 必填证据 |
| --- | --- |
| HTTPS origin | 实际 `https://` origin、DNS 所有人、证书自动续期与到期告警 |
| WebAuthn RP ID | 与 origin 相等或为其可注册后缀；变更影响和回滚已确认 |
| 数据区域 | `DATA_REGION` 与邀请地区、隐私声明、数据库实际区域一致 |
| Secret 管理 | PostgreSQL URL 与 32+ 字符随机 pepper 从 secret manager 以文件挂载；环境间不复用 |
| 数据库 | TLS 主机名验证、PITR/备份窗口、恢复演练、容量与连接上限 |
| 审计保留 | audit allowlist、保留天数、删除责任人与合法依据 |
| 监控值班 | readiness、5xx、429、数据库连接、认证失败率和延迟的阈值/接收人 |
| 回滚 | 前一镜像标识、入口切换步骤、数据库前向兼容确认和责任人 |

## 3. 必需配置

非秘密配置：

```text
EXPECTED_ORIGIN=https://beta.example.com
RP_ID=example.com
RP_NAME=VoiceID Online Beta
DATA_REGION=<approved-managed-postgres-region>
EDGE_PORT=8080
```

秘密文件：

```text
DATABASE_URL_SECRET_FILE=/secure/path/database-url
TOKEN_PEPPER_SECRET_FILE=/secure/path/token-pepper
```

数据库 URL 示例形态为 `postgres://…/voiceid?sslmode=verify-full`。不要把实际凭据写入 `.env`、Compose 文件、CI 日志或 Git。`TOKEN_PEPPER` 轮换会同时失效所有 session、challenge、操作确认和未使用邀请，因此只能作为计划内的全局撤销操作执行。

## 4. 构建与配置验证

从仓库根目录执行：

```bash
docker build --file infra/containers/Dockerfile.api --tag voiceid-auth-api:<git-sha> .
docker build --file infra/containers/Dockerfile.web --tag voiceid-web:<git-sha> .
docker run --rm --entrypoint caddy voiceid-web:<git-sha> validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --file infra/compose.staging.yml config --quiet
```

镜像必须由已通过 `Quality gate` 的 commit 构建，并由部署系统记录不可变镜像摘要。当前工作流检查两个镜像都能构建、Caddy 配置能解析、Compose 强制变量能展开。

## 5. 启动与健康检查

```bash
docker compose --file infra/compose.staging.yml up --build --detach
```

入口完成 HTTPS 配置后检查：

```bash
curl --fail --silent --show-error https://<origin-host>/healthz
curl --fail --silent --show-error https://<origin-host>/readyz
curl --fail --silent --show-error https://<origin-host>/openapi.json
```

`/healthz` 只证明进程存活；`/readyz` 会查询 PostgreSQL。只有二者成功且网页响应包含预期 CSP、`X-Content-Type-Options`、`Permissions-Policy`、`Referrer-Policy` 时才能发邀请。

## 6. 邀请发行

每个邀请只能使用一次，原始 code 只打印一次。数据库保存 code 的 HMAC、标签、发行人、到期与消费状态，不保存原文。

```bash
docker compose --file infra/compose.staging.yml run --rm auth-api \
  node services/auth-api/dist/cli/issue-invitation.js \
  --label "Beta cohort 001" \
  --issued-by "operator-id" \
  --expires-in-hours 72
```

通过已批准的单独渠道把 code 交给指定测试者。不要粘贴到 issue、聊天群、分析平台或共享日志。发行操作应由变更单关联到操作者；批量发行和管理后台尚未实现。

## 7. 发布烟测

使用专用测试账户完成并保存时间戳与请求 ID：

1. 兑换一次性邀请并注册 Primary Passkey；相同邀请再次提交必须失败。
2. 刷新页面，由服务端恢复 session；退出后旧 session 不可复用。
3. 用 Primary Passkey 确认后，在另一设备/认证器添加 Backup Passkey；页面显示 `Recovery ready`。
4. 尝试撤销最后一个 Passkey 必须失败；有两个 Passkey 时撤销其中一个必须同时撤销全部 session。
5. 不同用途的确认、已消费确认、旧 challenge 和恶意 Origin 必须失败。
6. 输入 `DELETE` 并用 Passkey 确认删除账户；随后所有原 Passkey 登录必须失败，profile 已最小化。
7. 确认浏览器网络中没有声音、钱包、PIN、恢复串或生物数据请求。

## 8. 监控与事件响应

边缘层输出 JSON access log，Auth API 输出不含 WebAuthn payload、Cookie、code 或 secret 的结构化运行日志。日志采集必须再次配置字段 allowlist，不得记录请求体或 `Cookie`/`Set-Cookie` header。

立即阻断新邀请并关闭入口的条件：

- readiness 连续失败或数据库进入只读/恢复状态；
- 5xx、认证失败或 429 明显偏离已批准基线；
- origin/RP ID/TLS、secret 或数据库区域发生未审批变化；
- 发现 session、邀请、WebAuthn response 或个人数据进入日志；
- 删除、撤销或最后凭证保护未按烟测结果工作。

涉及凭据或 session 泄露时，先关闭入口，再计划轮换 pepper。轮换 pepper 是全局 session/邀请撤销，不应在未知影响下直接执行。

## 9. 回滚与恢复

- 应用回滚：停止发邀请，将入口切回前一已验证镜像；`002_account_lifecycle.sql` 是加列/加表的前向兼容迁移，不执行自动 down migration。
- 数据库异常：先停止写流量，按托管 PostgreSQL Runbook 恢复到隔离实例，验证 migration ledger、用户/凭证/session 数量和 `/readyz` 后再决定切换。
- 删除异常：立即暂停入口和邀请，不从备份把已删除账户直接恢复到在线库；由隐私与事件负责人决定隔离调查和通知。
- Pages 官网与 Browser Playground 是独立发布面，预发回滚不得覆盖或暴露 `apps/`、`services/`、secret 或数据库产物。

## 10. 仍未解除的生产阻塞

容器和 Runbook 不等于生产批准。真实用户开放前仍需完成：实际基础设施变更审查、备份恢复演练、告警演练、依赖/SAST/DAST、ASVS L2 证据映射、审计保留执行器、数据主体导出流程、独立安全与隐私审查。SIWE、声音、钱包、链写入和生物数据仍全部关闭。
