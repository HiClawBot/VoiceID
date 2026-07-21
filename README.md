# VoiceID

VoiceID 是声纹身份协议官网项目。

当前有两个严格隔离的可运行产物：

- **Browser Playground v0.1**：公网静态演示，只展示随机挑战、浏览器音频质量、模拟 `VoiceProof`、测试钱包签名和本地会话；不识别真实说话人，也不提供服务端认证。
- **Online Beta Auth Skeleton v0.2**：本地/测试环境的真实 Passkey 注册、登录、刷新恢复、退出和撤销闭环，使用 Fastify、PostgreSQL、WebAuthn 与 `HttpOnly` 会话；当前未部署生产，也不收集声音或连接钱包。

真实 Online Beta 的目标架构、质量门与未完成的生产前置见施工计划。

官网由 GitHub Pages 托管，静态文件位于仓库根目录：

- `index.html`
- `styles.css`
- `script.js`
- `assets/`
- `downloads/`
- `docs/`
- `beta/`

## 项目文档

- [VoiceID 开发计划施工文档](docs/VoiceID_开发计划施工文档.md)
- [VoiceID Beta 施工计划](docs/VoiceID_Beta_施工计划.md)
- [VoiceID Online Beta v0.2 就绪度审计与施工计划](docs/VoiceID_Online_Beta_施工计划_v0.2.md)
- [VoiceID Online Beta v0.2 可视化决策稿](docs/VoiceID_Online_Beta_施工计划_v0.2.html)
- [ADR-001：Beta 挑战与签名分层](docs/ADR-001_Beta_挑战与签名分层.md)
- [ADR-002：Online Beta 信任根与语音数据边界](docs/ADR-002_Online_Beta_信任根与语音数据边界.md)
- [VoiceID Protocol Schema](docs/VoiceID_Protocol_Schema.md)
- [VoiceID Beta 验收清单](docs/VoiceID_Beta_验收清单.md)
- [Browser Playground v0.1 Release Notes](docs/RELEASE_v0.1_Playground.md)
- [Online Beta Auth Skeleton v0.2 Release Notes](docs/RELEASE_v0.2_Auth_Skeleton.md)

## 本地预览

```bash
python3 -m http.server 3400
```

打开 `http://localhost:3400`。

- 官网：`http://localhost:3400/`
- Browser Playground：`http://localhost:3400/beta/`
- 文档中心：`http://localhost:3400/docs/`

## 发布前检查

无需安装依赖，运行：

```bash
python3 scripts/check_site.py
```

检查覆盖本地链接与资源、页面锚点、基础 HTML 语义、英文页中文混入、本地预览端口范围，以及 Playground 的存储、RPC、网络调用和 demo-only 安全红线。

## Online Beta Auth Skeleton 本地运行

前置条件：Node.js `>=22.12`、npm、PostgreSQL 16+。只使用测试身份；不要输入真实敏感个人信息。

```bash
createdb voiceid_dev
createdb voiceid_test
cp .env.example .env
npm ci
npm run db:migrate
```

分别在两个终端运行：

```bash
npm run dev:api
```

```bash
npm run dev:web
```

打开 `http://localhost:5173`，本地开发邀请是 `.env` 中的 `DEV_INVITE_CODE`。API readiness 位于 `http://127.0.0.1:3401/readyz`，OpenAPI 3.1 文档位于 `http://127.0.0.1:3401/openapi.json`。

完整工作区检查：

```bash
TEST_DATABASE_URL=postgres://localhost/voiceid_test npm run check
npm run e2e
```

E2E 会先重置且仅允许重置名称以 `_test` 结尾的测试数据库，再使用 Chrome/Chromium 虚拟认证器验证注册、服务端会话恢复、退出、再次登录、重放拒绝、全会话撤销和 Origin 拒绝。

## 生产部署门槛

Auth Skeleton 不是生产发布批准。生产启动会拒绝 localhost、HTTP origin、非 Secure Cookie、开发 pepper 和开发邀请；正式部署还必须冻结并审查实际域名/RP ID、同源代理、数据库区域与备份、secret manager、邀请地区、保留/删除策略、可观测性、回滚和独立安全审查。声音、钱包、SIWE、主网和生物数据处理均不在本版本范围内。
