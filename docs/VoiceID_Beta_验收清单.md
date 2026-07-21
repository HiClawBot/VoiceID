# VoiceID Browser Beta v0.1 验收清单

版本：v0.1
日期：2026-07-11
范围：本地模拟声纹证明 + EIP-1193 测试签名 + 会话输出

## 1. 验收规则

- `自动`：由 `scripts/check_site.py`、JS 语法检查或浏览器自动化验证。
- `浏览器`：在本地 3400-3499 端口通过真实浏览器操作验证。
- `人工`：需要用户主动授权麦克风或在已安装钱包的浏览器中确认。
- 任何 P0 项失败都阻止 Beta 发布。
- 模拟路径必须始终标记为模拟，不得使用“安全认证完成”“身份已验证”等生产含义文案。

## 2. 功能闭环

| ID | Priority | Method | 验收项 | 通过标准 |
|---|---|---|---|---|
| F-01 | P0 | 自动 | `/beta/` 路由 | 返回一个 H1、一个 main，无缺失资源 |
| F-02 | P0 | 浏览器 | 生成挑战 | 显示 6 位数字、创建时间和 2 分钟过期提示 |
| F-03 | P0 | 浏览器 | 更新挑战 | 新挑战 ID 与数字变化，旧证明和后续状态清空 |
| F-04 | P0 | 人工 | 麦克风成功采样 | 明确授权后显示时长/音量；停止后设备指示释放 |
| F-05 | P0 | 浏览器 | 演示音频指标 | 无麦克风时可选择明确标记的模拟输入完成流程 |
| F-06 | P0 | 浏览器 | 生成 VoiceProof | `method=local-simulated-v0`、`assurance=demo-only`、`rawAudioPersisted=false` |
| F-07 | P0 | 浏览器 | 创建身份档案 | 只写当前标签会话，显示 proof ID 与 session-only |
| F-08 | P0 | 浏览器 | 无钱包状态 | 显示 `WALLET_MISSING`，提供模拟钱包路径，不阻塞页面 |
| F-09 | P1 | 人工 | 注入钱包连接 | 只请求账户和 chain ID，显示截断地址和网络 |
| F-10 | P0 | 浏览器 | 模拟钱包连接 | 显示 Sepolia chain ID `11155111` 与 simulated 标识 |
| F-11 | P1 | 人工 | 钱包测试签名 | 钱包展示可读消息；用户签名后页面只标记 signed-demo |
| F-12 | P0 | 浏览器 | 模拟签名 | 生成动态 nonce 与 AuthSession，`serverVerified=false` |
| F-13 | P0 | 浏览器 | 会话结果 | 展示 profile/proof/wallet/session ID、范围、签名模式和过期时间 |
| F-14 | P0 | 浏览器 | 重置 | 清空 UI、内存对象与四个 `sessionStorage` 键，返回 idle |

## 3. 失败与恢复

| ID | Priority | Method | 场景 | 通过标准 |
|---|---|---|---|---|
| E-01 | P0 | 浏览器 | 挑战过期 | 阻止采样/证明复用并提示生成新挑战 |
| E-02 | P0 | 人工 | 麦克风拒绝 | 显示 `MIC_DENIED`，允许重试或选择模拟输入 |
| E-03 | P0 | 人工 | 无音频设备 | 显示 `MIC_NOT_FOUND`，页面不崩溃 |
| E-04 | P0 | 浏览器 | 采样过短 | 显示 `MIC_TOO_SHORT`，允许重新采样 |
| E-05 | P1 | 人工 | 音量过低/削波 | 显示具体质量状态，不生成 verified proof |
| E-06 | P0 | 浏览器 | 未完成证明就连接钱包 | 按钮保持禁用并解释前置条件 |
| E-07 | P0 | 人工 | 拒绝账户连接 | 显示 `WALLET_REJECTED`，可重试或使用模拟路径 |
| E-08 | P0 | 人工 | 拒绝签名 | 显示 `SIGNATURE_REJECTED`，proof/profile 不丢失 |
| E-09 | P0 | 浏览器 | 重置后旧按钮动作 | 不得复用旧 proof、wallet 或 session |

## 4. 隐私与安全红线

| ID | Priority | Method | 验收项 | 通过标准 |
|---|---|---|---|---|
| S-01 | P0 | 自动 | 无真实交易 RPC | Beta JS 不包含 `eth_sendTransaction`、`eth_signTransaction`、`wallet_switchEthereumChain` |
| S-02 | P0 | 自动 | 无长期存储 | Beta JS 不使用 `localStorage`、IndexedDB、Cookie、Cache Storage |
| S-03 | P0 | 自动 | 原始音频不持久化 | 不使用 MediaRecorder、Blob、ArrayBuffer 导出或网络上传音频 |
| S-04 | P0 | 自动 | 无外部传输 | Beta JS 不调用 `fetch`、XHR、WebSocket、sendBeacon |
| S-05 | P0 | 浏览器 | 麦克风释放 | 成功、失败、取消和重置后所有 MediaStreamTrack 均停止 |
| S-06 | P0 | 自动 | 会话存储白名单 | 只允许 Schema 定义的四个 `voiceid.beta.*` 键 |
| S-07 | P0 | 浏览器 | 模拟标识 | VoiceProof、钱包回退和 AuthSession 都明确显示 demo/simulated |
| S-08 | P0 | 浏览器 | 签名来源绑定 | 消息包含当前 domain、URI、chain ID、nonce、issued-at、expiration-time、proof request ID |
| S-09 | P0 | 浏览器 | 不声称服务端验签 | 页面显示 `serverVerified=false` 与“未进行服务端验签” |
| S-10 | P0 | 自动 | 无敏感值日志 | JS 不记录音频数据、PIN、恢复密钥、签名或完整钱包地址到 console |

## 5. PIN 与恢复演示

| ID | Priority | Method | 验收项 | 通过标准 |
|---|---|---|---|---|
| R-01 | P1 | 浏览器 | PIN 演示 | 只接受 6 位数字，校验后立即清空输入，不持久化 |
| R-02 | P1 | 浏览器 | 恢复密钥演示 | 只接受 `VOICE-XXXX-XXXX` 格式，校验后立即清空 |
| R-03 | P1 | 浏览器 | 无真实恢复 | 明确说明演示只改变当前 profile 的 recoveryMethod |

## 6. 可访问性与响应式

| ID | Priority | Method | 验收项 | 通过标准 |
|---|---|---|---|---|
| A-01 | P0 | 自动 | 页面语义 | H1/main 各 1，表单控件有 label，状态区域使用 `aria-live` |
| A-02 | P0 | 浏览器 | 键盘流程 | 可按挑战、采样/模拟、钱包、签名、重置顺序操作 |
| A-03 | P0 | 浏览器 | 禁用说明 | 禁用按钮附近有可见前置条件，不只依赖颜色 |
| A-04 | P0 | 浏览器 | 动效降级 | `prefers-reduced-motion` 下关闭非必要循环动画 |
| A-05 | P0 | 浏览器 | 手机布局 | 320、375、768、1440px 无页面级横向溢出 |
| A-06 | P1 | 浏览器 | 状态对比度 | 正常、处理中、成功、警告和错误均有文字标签 |

## 7. 发布检查命令

```bash
python3 scripts/check_site.py
node --check script.js
node --check beta/beta.js
node --check beta/adapters/voice-proof.js
node --check beta/adapters/wallet-provider.js
git diff --check
```

## 8. 本轮交付判定

发布 Browser Beta v0.1 前必须满足：

- 所有 P0 自动项通过。
- 所有不需要真实硬件/钱包的 P0 浏览器项通过。
- 麦克风与注入钱包人工项保留清晰测试步骤；若当前环境无法授权，必须标记为“待人工”，不能伪报通过。
- 已知限制、模拟边界和未完成服务端验签在页面上可见。
