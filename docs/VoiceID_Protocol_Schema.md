# VoiceID Beta Protocol Schema v0.1

状态：Draft for Browser Playground v0.1
日期：2026-07-11
对应决策：[`ADR-001_Beta_挑战与签名分层.md`](ADR-001_Beta_挑战与签名分层.md)

## 1. 通用约定

- 所有时间使用 ISO 8601 UTC 字符串。
- ID 由 Web Crypto 随机数生成，前缀只用于调试识别。
- Beta 授权范围仅允许 `login`、`wallet:sign`、`identity:read`、`recovery:test`。
- `VoiceProof.assurance` 必须为 `demo-only`。
- 原始音频、声纹模板、私钥、助记词、PIN 和恢复密钥不得进入任何协议对象。
- 所有证明和会话都有过期时间；过期对象不能继续驱动后续步骤。
- 未完成服务端验签时，`AuthSession.serverVerified` 必须为 `false`。

## 2. 状态流

```text
idle
  -> challenge-issued
  -> sampling
  -> proof-ready
  -> profile-ready
  -> wallet-ready
  -> signing
  -> session-ready

任何状态 -> recoverable-error -> 最近可恢复状态
任何状态 -> reset -> idle
```

## 3. VoiceChallenge

用途：描述一次有时效的本地随机数字采样任务。

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `id` | string | 是 | `vc_` 前缀随机 ID |
| `type` | string | 是 | 固定 `VoiceChallenge` |
| `version` | string | 是 | 固定 `0.1` |
| `phrase` | string | 是 | 6 位数字，不作为秘密 |
| `purpose` | string | 是 | 固定 `local-presence-demo` |
| `createdAt` | datetime | 是 | 创建时间 |
| `expiresAt` | datetime | 是 | 创建后 2 分钟 |
| `status` | enum | 是 | `issued`、`sampling`、`completed`、`expired`、`cancelled` |

```json
{
  "id": "vc_7f3c9a21",
  "type": "VoiceChallenge",
  "version": "0.1",
  "phrase": "482719",
  "purpose": "local-presence-demo",
  "createdAt": "2026-07-11T08:00:00.000Z",
  "expiresAt": "2026-07-11T08:02:00.000Z",
  "status": "issued"
}
```

## 4. VoiceProof

用途：表达本地音频输入通过基础质量阈值。它不是生产声纹认证结果。

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `id` | string | 是 | `vp_` 前缀随机 ID |
| `type` | string | 是 | 固定 `VoiceProof` |
| `version` | string | 是 | 固定 `0.1` |
| `challengeId` | string | 是 | 指向未过期 `VoiceChallenge.id` |
| `scope` | string[] | 是 | 本轮默认 `login`、`wallet:sign` |
| `createdAt` | datetime | 是 | 证明生成时间 |
| `expiresAt` | datetime | 是 | 创建后 5 分钟 |
| `method` | string | 是 | 固定 `local-simulated-v0` |
| `assurance` | string | 是 | 固定 `demo-only` |
| `status` | enum | 是 | `verified` 或 `rejected` |
| `audioQuality` | object | 是 | 只含非可逆质量指标 |
| `rawAudioPersisted` | boolean | 是 | 固定 `false` |

`audioQuality`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `durationMs` | integer | 采样时长 |
| `rms` | number | 归一化均方根音量，0-1 |
| `peak` | number | 归一化峰值，0-1 |
| `clippingRatio` | number | 接近满幅样本占比，0-1 |
| `quality` | enum | `good`、`too-quiet`、`too-short`、`clipping` |
| `source` | enum | `microphone` 或 `simulated-input` |

```json
{
  "id": "vp_a62e15d4",
  "type": "VoiceProof",
  "version": "0.1",
  "challengeId": "vc_7f3c9a21",
  "scope": ["login", "wallet:sign"],
  "createdAt": "2026-07-11T08:00:18.000Z",
  "expiresAt": "2026-07-11T08:05:18.000Z",
  "method": "local-simulated-v0",
  "assurance": "demo-only",
  "status": "verified",
  "audioQuality": {
    "durationMs": 4218,
    "rms": 0.084,
    "peak": 0.612,
    "clippingRatio": 0.001,
    "quality": "good",
    "source": "microphone"
  },
  "rawAudioPersisted": false
}
```

## 5. IdentityProfile

用途：组织当前标签会话内的演示身份状态。

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `id` | string | 是 | `vid_` 前缀随机 ID |
| `type` | string | 是 | 固定 `IdentityProfile` |
| `version` | string | 是 | 固定 `0.1` |
| `createdAt` | datetime | 是 | 创建时间 |
| `updatedAt` | datetime | 是 | 最近更新时间 |
| `voiceProofId` | string | 是 | 当前有效证明 |
| `walletBindingId` | string/null | 是 | 未连接时为 `null` |
| `recoveryMethod` | enum | 是 | `pin-demo`、`recovery-key-demo`、`none` |
| `storage` | string | 是 | 固定 `session-only` |
| `localOnly` | boolean | 是 | 固定 `true` |

```json
{
  "id": "vid_44a91f3b",
  "type": "IdentityProfile",
  "version": "0.1",
  "createdAt": "2026-07-11T08:00:18.000Z",
  "updatedAt": "2026-07-11T08:00:18.000Z",
  "voiceProofId": "vp_a62e15d4",
  "walletBindingId": null,
  "recoveryMethod": "none",
  "storage": "session-only",
  "localOnly": true
}
```

## 6. WalletBinding

用途：记录当前会话连接的钱包公开信息。不得包含私钥或助记词。

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `id` | string | 是 | `wb_` 前缀随机 ID |
| `type` | string | 是 | 固定 `WalletBinding` |
| `version` | string | 是 | 固定 `0.1` |
| `mode` | enum | 是 | `eip1193` 或 `simulated` |
| `address` | string | 是 | EVM 地址或明确的模拟地址 |
| `chainId` | string | 是 | EIP-155 十进制字符串；模拟模式为 `11155111` |
| `connectedAt` | datetime | 是 | 连接时间 |
| `providerVerified` | boolean | 是 | 真实注入 Provider 返回时为 `true` |

```json
{
  "id": "wb_0d81e6aa",
  "type": "WalletBinding",
  "version": "0.1",
  "mode": "eip1193",
  "address": "0x8B6E2f8B42D69B1aA8c20B55d94F6A53cD9127E4",
  "chainId": "11155111",
  "connectedAt": "2026-07-11T08:01:00.000Z",
  "providerVerified": true
}
```

## 7. AuthSession

用途：表达一次完成到签名返回阶段的 Beta 会话。

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `id` | string | 是 | `as_` 前缀随机 ID |
| `type` | string | 是 | 固定 `AuthSession` |
| `version` | string | 是 | 固定 `0.1` |
| `profileId` | string | 是 | 当前 `IdentityProfile.id` |
| `voiceProofId` | string | 是 | 当前未过期证明 |
| `walletBindingId` | string | 是 | 当前钱包绑定 |
| `scope` | string[] | 是 | 本轮授权范围 |
| `nonce` | string | 是 | 至少 12 位随机字母数字 |
| `issuedAt` | datetime | 是 | 签名请求时间 |
| `expiresAt` | datetime | 是 | 创建后 5 分钟 |
| `signatureMode` | enum | 是 | `wallet` 或 `simulated` |
| `status` | string | 是 | 固定 `signed-demo` |
| `serverVerified` | boolean | 是 | 固定 `false` |

签名字符串只保存在当前页面内存，不写入 `AuthSession` 的会话存储副本。

```json
{
  "id": "as_9b61d2ce",
  "type": "AuthSession",
  "version": "0.1",
  "profileId": "vid_44a91f3b",
  "voiceProofId": "vp_a62e15d4",
  "walletBindingId": "wb_0d81e6aa",
  "scope": ["login", "wallet:sign"],
  "nonce": "K7F2M9Q4X8CP",
  "issuedAt": "2026-07-11T08:01:12.000Z",
  "expiresAt": "2026-07-11T08:06:12.000Z",
  "signatureMode": "wallet",
  "status": "signed-demo",
  "serverVerified": false
}
```

## 8. ProtocolError

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | string | 稳定错误码 |
| `stage` | string | `challenge`、`microphone`、`profile`、`wallet`、`signature`、`recovery` |
| `message` | string | 面向用户的短说明 |
| `recoverable` | boolean | 是否允许原地重试 |
| `createdAt` | datetime | 发生时间 |

错误码：

| Code | Stage | Recoverable | 含义 |
|---|---|---|---|
| `CHALLENGE_EXPIRED` | challenge | 是 | 挑战已过期，生成新挑战 |
| `MIC_UNAVAILABLE` | microphone | 否 | 浏览器或上下文不支持麦克风 |
| `MIC_DENIED` | microphone | 是 | 用户拒绝权限 |
| `MIC_NOT_FOUND` | microphone | 是 | 没有音频输入设备 |
| `MIC_ABORTED` | microphone | 是 | 设备或浏览器中止采样 |
| `MIC_TOO_SHORT` | microphone | 是 | 采样不足最低时长 |
| `MIC_TOO_QUIET` | microphone | 是 | 输入音量过低 |
| `MIC_CLIPPING` | microphone | 是 | 削波比例过高 |
| `WALLET_MISSING` | wallet | 是 | 未检测到注入 Provider |
| `WALLET_REJECTED` | wallet | 是 | 用户拒绝账户访问 |
| `WALLET_UNAVAILABLE` | wallet | 是 | Provider 请求失败或无账户 |
| `SIGNATURE_REJECTED` | signature | 是 | 用户拒绝签名 |
| `SIGNATURE_FAILED` | signature | 是 | Provider 未返回有效签名 |
| `SESSION_EXPIRED` | signature | 是 | 证明或签名请求已过期 |
| `RECOVERY_INVALID` | recovery | 是 | 演示 PIN 或恢复密钥格式不合法 |

## 9. 存储键

Beta 只允许以下 `sessionStorage` 键：

```text
voiceid.beta.profile
voiceid.beta.proof
voiceid.beta.wallet
voiceid.beta.session
```

禁止使用 `localStorage`、IndexedDB、Cache Storage 或 Cookie 保存 Beta 身份状态。重置操作必须删除所有上述键。

## 10. 兼容与演进

- 新增字段必须保持向后可忽略。
- 修改字段语义必须提升 `version`。
- 将 `assurance` 升级为非 `demo-only` 属于安全模型变更，必须新增 ADR。
- 引入非 EVM 钱包时新增适配器和链命名约定，不复用 EIP-155 `chainId` 语义。
