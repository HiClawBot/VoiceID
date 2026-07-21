# VoiceID

VoiceID 是声纹身份协议官网项目。

当前可运行产物是 **Browser Playground v0.1**：它只演示随机挑战、浏览器音频质量检查、模拟 `VoiceProof`、测试钱包签名和本地会话，不识别真实说话人，也不提供服务端认证。真实 Online Beta 的目标架构与质量门见施工计划。

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
