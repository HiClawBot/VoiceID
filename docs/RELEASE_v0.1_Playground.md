# VoiceID Browser Playground v0.1 Release Notes

状态：Release candidate
日期：2026-07-21
发布路径：`/beta/`

## 本次提供

- 2 分钟过期的随机 6 位数字挑战。
- 浏览器麦克风授权、4.2 秒采样、时长/RMS/峰值/削波质量计算与音轨释放。
- 无麦克风权限时可使用明确标记的模拟音频指标。
- `demo-only`、`local-simulated-v0`、`rawAudioPersisted=false` 的 `VoiceProof`。
- 当前标签页内的演示身份档案、PIN/恢复串格式回退演示。
- EIP-1193 注入钱包连接、测试消息签名与明确标记的模拟钱包路径。
- `signed-demo`、`serverVerified=false` 的本地 `AuthSession` 输出与一键重置。
- 中英文官网、Docs、协议 Schema、ADR、验收清单和 Online Beta 决策稿入口。

## 明确不提供

- 不识别用户是否念对随机数字，不识别真实说话人。
- 不检测或阻止录音回放、TTS、AI 克隆或虚拟音频设备注入。
- 不执行服务端钱包验签、nonce 消费或认证会话签发。
- 不发起转账、代币授权、切链或任何资产操作。
- 不生成、托管或恢复私钥/助记词，不执行真实 PIN 恢复。
- 不上传或持久化原始音频，不建立声纹模板。

## 发布质量门

```bash
python3 scripts/check_site.py
node --check script.js
node --check beta/beta.js
node --check beta/adapters/voice-proof.js
node --check beta/adapters/wallet-provider.js
git diff --check
```

浏览器冒烟覆盖：

- 390px 与桌面宽度无页面横向溢出。
- 演示音频 → 模拟钱包 → 测试签名 → `signed-demo` 会话。
- 会话输出包含 `serverVerified=false` 与 `signatureMode=simulated`。
- 重置后证明、钱包、会话与输出回到初始状态。
- 官网、Docs 和 Playground 在手机导航中始终保留关键入口。

## 回滚

- 发布前保留上一可用 Git commit。
- 若静态资源、路由或公开能力状态异常，回滚本次发布提交即可；本版本没有数据库迁移或用户数据迁移。
- `/beta/` 与 `/docs/` 可独立从导航撤下，不影响根目录官网。
- 发现误导文案、真实资产 RPC、外部网络调用、持久音频或 `serverVerified=true` 时立即停止发布。

## 后续

真实 Online Beta 不在本版本内。下一阶段按 ADR-002 先建立 Passkey/SIWE、服务器 challenge、HttpOnly 会话、同意与删除路径，再接真实语音实验。
