# ADR-001：Beta 语音挑战与钱包签名分层

状态：Accepted
日期：2026-07-11
适用范围：VoiceID Browser Beta v0.1

## 1. 背景

现有白皮书把固定短语定义为本地声纹解锁入口，把应用动态 challenge 定义为钱包签名的抗重放输入；Beta 施工计划又提出随机数字或短语挑战。三者如果不分层，容易产生两个错误理解：

- 把随机数字朗读当成已经完成说话人身份识别。
- 把声纹结果当成可以替代钱包 nonce、来源校验和服务端验签的远程认证因素。

Beta 没有生产声纹模型、活体检测模型、后端 nonce 服务或签名验证服务，因此必须诚实表达演示边界。

## 2. 决策

VoiceID Beta 将挑战分成三个独立层次。

### 2.1 固定注册短语：未来 Enrollment 层

- 示例：`123456789` 与 `A-Z`。
- 用途：未来建立本地声纹模板、做模型一致性测试。
- Beta v0.1：不实现注册模板，不声称完成声纹 enrollment。

### 2.2 随机数字挑战：本地 Presence Demo 层

- 每次生成 6 位随机数字，2 分钟后过期。
- 浏览器只检查麦克风可用性、采样时长、RMS 音量、峰值与削波比例。
- 输出 `VoiceProof`，其 `method` 固定为 `local-simulated-v0`，`assurance` 固定为 `demo-only`。
- 通过只表示“用户在本次流程中授权了麦克风并产生了达到基础阈值的音频输入”，不表示“已识别出特定自然人”。
- 原始音频不编码、不上传、不写入浏览器存储；停止采样后立即停止所有音轨并释放 AudioContext。

### 2.3 动态签名 nonce：Wallet Control 层

- 每个会话使用 Web Crypto 生成不少于 12 位的随机字母数字 nonce。
- 签名消息采用 ERC-4361 可读字段：domain、address、URI、version、chain ID、nonce、issued-at、expiration-time、request ID。
- `request ID` 绑定本次 `VoiceProof.id`，防止 UI 把旧证明静默复用到新签名请求。
- Beta 通过 EIP-1193 Provider 请求账户与签名，只请求 `eth_requestAccounts`、`eth_chainId` 和 `personal_sign`。
- Beta 禁止调用 `eth_sendTransaction`、`eth_signTransaction`、授权代扣、切换主网或任何资产操作。
- 浏览器端只记录“钱包返回了签名”；由于没有可信后端或 ERC-1271/EOA 验签实现，`AuthSession.serverVerified` 必须为 `false`。

## 3. 流程门控

```text
VoiceChallenge issued
  -> microphone quality passed
  -> VoiceProof(status=verified, assurance=demo-only)
  -> local IdentityProfile created
  -> wallet connected or explicit simulated-wallet fallback
  -> readable sign-in message signed or simulated
  -> AuthSession(status=signed-demo, serverVerified=false)
```

任何一步失败都不能自动跳过到下一敏感步骤。用户可以重试、选择明确标识的模拟路径或清空会话。

## 4. 数据生命周期

| 数据 | 存放位置 | 生命周期 | 禁止事项 |
|---|---|---|---|
| 原始音频流 | 浏览器内存 | 采样期间 | 编码、上传、持久化 |
| 音频质量指标 | 当前页面内存 | 当前会话 | 当作声纹模板或自然人身份 |
| `VoiceProof` | `sessionStorage` | 当前浏览器标签会话 | 宣称生产认证、跨设备复用 |
| `IdentityProfile` | `sessionStorage` | 当前浏览器标签会话 | 存储私钥、助记词、PIN 明文 |
| 钱包地址/chain ID | 当前会话 | 当前浏览器标签会话 | 自动发交易、后台关联其他站点 |
| 签名 | 当前页面内存 | 当前页面生命周期 | 上传、复用为新会话 |
| PIN/恢复密钥演示输入 | 不存储 | 校验后立即丢弃 | 日志记录、持久化、派生真实密钥 |

## 5. 被否决方案

### 方案 A：固定短语直接登录

否决。固定音频容易被录音或合成重放，且不能替代动态签名 nonce。

### 方案 B：随机朗读即真实声纹认证

否决。Beta 没有说话人模型、模板注册、偏差评估或活体检测，不能作此声明。

### 方案 C：只做钱包签名，跳过语音流程

否决。无法验证 VoiceID 的产品编排价值，也无法建立未来声纹适配器接口。

### 方案 D：为了演示直接发测试网交易

否决。登录证明不需要交易；交易会扩大钱包权限与误操作风险。

## 6. 后果

正面影响：

- 产品演示有完整顺序，同时不会伪装成生产认证。
- 声纹适配器与钱包适配器可以独立替换。
- 错误、过期和回退路径可以单独测试。

限制：

- Beta 不能验证真实说话人身份。
- Beta 不能验证钱包签名的密码学有效性或合约账户状态。
- 刷新页面可能丢失签名结果；这是避免长期保存敏感会话数据的有意取舍。

## 7. 后续升级门槛

只有完成以下工作后，才能把 `assurance` 从 `demo-only` 升级：

- 真实模型接口、模板注册、活体/重放测试和偏差评估。
- 原始音频与特征数据的正式隐私影响评估。
- 服务端 nonce、SIWE 解析、EOA/ERC-1271 验签和会话撤销。
- 第三方安全审计与合规评估。
