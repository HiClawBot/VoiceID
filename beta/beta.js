import {
  VoiceIDError,
  createChallenge,
  createDemoAudioQuality,
  createIdentityProfile,
  createVoiceProof,
  isExpired,
  sampleMicrophone,
} from "./adapters/voice-proof.js";
import {
  connectInjectedWallet,
  createAuthSession,
  createSigningRequest,
  createSimulatedWallet,
  signRequest,
  subscribeProvider,
} from "./adapters/wallet-provider.js";

const STORAGE = {
  proof: "voiceid.beta.proof",
  profile: "voiceid.beta.profile",
  wallet: "voiceid.beta.wallet",
  session: "voiceid.beta.session",
};

const elements = Object.fromEntries(
  [
    "app-status",
    "app-status-title",
    "app-status-copy",
    "challenge-value",
    "challenge-id",
    "challenge-expiry",
    "challenge-state",
    "sampling-copy",
    "level-track",
    "level-fill",
    "start-microphone",
    "use-demo-audio",
    "new-challenge",
    "challenge-error",
    "metric-duration",
    "metric-rms",
    "metric-peak",
    "metric-clipping",
    "metric-quality",
    "profile-state",
    "proof-title",
    "proof-description",
    "proof-id",
    "profile-id",
    "profile-storage",
    "proof-assurance",
    "recovery-controls",
    "pin-form",
    "pin-input",
    "recovery-form",
    "recovery-input",
    "recovery-status",
    "recovery-error",
    "wallet-state",
    "connect-wallet",
    "use-demo-wallet",
    "wallet-mode",
    "wallet-address",
    "wallet-chain",
    "wallet-provider",
    "signing-message",
    "sign-message",
    "wallet-error",
    "session-state",
    "session-heading",
    "session-description",
    "session-output",
    "copy-session",
    "reset-session",
  ].map((id) => [id, document.getElementById(id)]),
);

const railSteps = Object.fromEntries(
  ["challenge", "profile", "wallet", "session"].map((step) => [
    step,
    document.querySelector(`[data-rail-step="${step}"]`),
  ]),
);

const state = {
  challenge: null,
  audioQuality: null,
  proof: null,
  profile: null,
  provider: null,
  wallet: null,
  signingRequest: null,
  signature: null,
  session: null,
  sampling: false,
  captureController: null,
  unsubscribeProvider: () => {},
};

const safeStore = (key, value) => {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The demo remains usable in memory when storage is unavailable.
  }
};

const safeRead = (key) => {
  try {
    const value = sessionStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

const clearStorage = () => Object.values(STORAGE).forEach((key) => safeStore(key, null));

const setStatus = (kind, title, copy) => {
  elements["app-status"].dataset.kind = kind;
  elements["app-status-title"].textContent = title;
  elements["app-status-copy"].textContent = copy;
};

const showError = (target, error) => {
  const message = error instanceof VoiceIDError ? `${error.code} · ${error.message}` : "操作失败，请重试。";
  target.textContent = message;
  target.hidden = false;
  setStatus("error", "流程需要处理", message);
};

const clearError = (target) => {
  target.textContent = "";
  target.hidden = true;
};

const formatTime = (value) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
};

const shortId = (value) => (value ? `${value.slice(0, 8)}…${value.slice(-4)}` : "—");
const shortAddress = (value) => (value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—");

const setRailState = (step, status, copy) => {
  railSteps[step].dataset.state = status;
  railSteps[step].querySelector("small").textContent = copy;
};

const renderMetrics = () => {
  const quality = state.audioQuality;
  elements["metric-duration"].textContent = quality ? `${quality.durationMs} ms` : "—";
  elements["metric-rms"].textContent = quality ? quality.rms.toFixed(4) : "—";
  elements["metric-peak"].textContent = quality ? quality.peak.toFixed(4) : "—";
  elements["metric-clipping"].textContent = quality ? `${(quality.clippingRatio * 100).toFixed(2)}%` : "—";
  elements["metric-quality"].textContent = quality ? `${quality.quality} · ${quality.source}` : "等待输入";
};

const renderChallenge = () => {
  if (state.proof && !isExpired(state.proof) && !state.challenge) {
    elements["challenge-value"].textContent = "RESTORED";
    elements["challenge-value"].setAttribute("aria-label", "已恢复当前标签会话中的 VoiceProof");
    elements["challenge-id"].textContent = shortId(state.proof.challengeId);
    elements["challenge-expiry"].textContent = formatTime(state.proof.expiresAt);
    elements["challenge-state"].textContent = "证明已恢复";
    return;
  }

  const challenge = state.challenge;
  elements["challenge-value"].textContent = challenge?.phrase || "------";
  elements["challenge-value"].setAttribute("aria-label", challenge ? `当前挑战数字 ${challenge.phrase}` : "尚无挑战");
  elements["challenge-id"].textContent = shortId(challenge?.id);
  elements["challenge-expiry"].textContent = formatTime(challenge?.expiresAt);

  if (state.sampling) elements["challenge-state"].textContent = "采样中";
  else if (state.proof && !isExpired(state.proof)) elements["challenge-state"].textContent = "已生成证明";
  else if (challenge && isExpired(challenge)) elements["challenge-state"].textContent = "已过期";
  else elements["challenge-state"].textContent = "待采样";
};

const renderProfile = () => {
  const hasProfile = Boolean(state.profile && state.proof && !isExpired(state.proof));
  elements["profile-state"].textContent = hasProfile ? "本地档案已创建" : "等待证明";
  elements["proof-title"].textContent = hasProfile ? "Demo-only VoiceProof 已就绪" : "尚未生成证明";
  elements["proof-description"].textContent = hasProfile
    ? "证明只表达本次输入通过基础音频质量阈值，不识别真实说话人。"
    : "完成声音挑战后，这里会显示 demo-only 证明与本地档案。";
  elements["proof-id"].textContent = shortId(state.proof?.id);
  elements["profile-id"].textContent = shortId(state.profile?.id);
  elements["profile-storage"].textContent = state.profile?.storage || "session-only";
  elements["proof-assurance"].textContent = state.proof?.assurance || "demo-only";
  elements["recovery-controls"].disabled = !hasProfile;
  elements["recovery-status"].textContent = hasProfile
    ? state.profile.recoveryMethod === "none"
      ? "当前回退方式：none"
      : `已完成格式演示：${state.profile.recoveryMethod}。输入未保存。`
    : "完成 VoiceProof 后可测试回退路径。";
};

const renderWallet = () => {
  const canConnect = Boolean(state.profile && state.proof && !isExpired(state.proof) && !state.sampling);
  const binding = state.wallet;
  elements["connect-wallet"].disabled = !canConnect;
  elements["use-demo-wallet"].disabled = !canConnect;
  elements["wallet-mode"].textContent = binding?.mode || "—";
  elements["wallet-address"].textContent = shortAddress(binding?.address);
  elements["wallet-address"].title = binding?.address || "";
  elements["wallet-chain"].textContent = binding?.chainId || "—";
  elements["wallet-provider"].textContent = binding
    ? binding.providerVerified
      ? "injected / returned"
      : "simulated / local"
    : "—";
  elements["wallet-state"].textContent = binding ? `${binding.mode} 已连接` : canConnect ? "可连接" : "等待身份档案";
  elements["sign-message"].disabled = !binding || !state.proof || isExpired(state.proof);
  elements["signing-message"].textContent = state.signingRequest?.message || "连接钱包后生成动态 nonce 与可读签名消息。";
};

const renderSession = () => {
  const session = state.session;
  elements["session-state"].textContent = session ? "signed-demo" : "等待签名";
  elements["session-heading"].textContent = session ? "Playground 会话已生成" : "尚未生成会话";
  elements["session-description"].textContent = session
    ? "钱包已返回签名或模拟签名，但没有进行服务端密码学验证。"
    : "完成测试签名后输出会话摘要；签名本身只保留在页面内存。";
  elements["session-output"].textContent = JSON.stringify(session || { status: "waiting" }, null, 2);
  elements["copy-session"].disabled = !session;
};

const renderRail = () => {
  setRailState("challenge", state.proof ? "complete" : "active", state.proof ? "证明已生成" : state.sampling ? "采样中" : "等待开始");
  setRailState("profile", state.profile ? "complete" : state.proof ? "active" : "locked", state.profile ? "档案已创建" : "尚未创建");
  setRailState("wallet", state.wallet ? "complete" : state.profile ? "active" : "locked", state.wallet ? `${state.wallet.mode} 已连接` : "尚未连接");
  setRailState("session", state.session ? "complete" : state.wallet ? "active" : "locked", state.session ? "signed-demo" : "尚未签名");
};

const render = () => {
  renderChallenge();
  renderMetrics();
  renderProfile();
  renderWallet();
  renderSession();
  renderRail();

  elements["start-microphone"].disabled = state.sampling || !state.challenge || Boolean(state.proof);
  elements["use-demo-audio"].disabled = state.sampling || !state.challenge || Boolean(state.proof);
  elements["new-challenge"].disabled = state.sampling;
  elements["start-microphone"].textContent = state.sampling ? "正在采样…" : "授权麦克风并采样";
};

const persistProfileState = () => {
  safeStore(STORAGE.proof, state.proof);
  safeStore(STORAGE.profile, state.profile);
  safeStore(STORAGE.wallet, state.wallet);
  safeStore(STORAGE.session, state.session);
};

const clearDownstream = () => {
  state.captureController?.abort();
  state.unsubscribeProvider();
  state.audioQuality = null;
  state.proof = null;
  state.profile = null;
  state.provider = null;
  state.wallet = null;
  state.signingRequest = null;
  state.signature = null;
  state.session = null;
  state.sampling = false;
  state.captureController = null;
  state.unsubscribeProvider = () => {};
  clearStorage();
  clearError(elements["challenge-error"]);
  clearError(elements["wallet-error"]);
  clearError(elements["recovery-error"]);
};

const issueChallenge = () => {
  clearDownstream();
  state.challenge = createChallenge();
  elements["level-fill"].style.transform = "scaleX(0)";
  elements["level-track"].setAttribute("aria-valuenow", "0");
  elements["sampling-copy"].textContent = "尚未访问麦克风";
  setStatus("info", "新挑战已生成", "请在 2 分钟内完成采样，或使用明确标记的演示输入。 ");
  render();
};

const completeProof = (audioQuality) => {
  state.audioQuality = audioQuality;
  state.proof = createVoiceProof(state.challenge, audioQuality);
  state.profile = createIdentityProfile(state.proof);
  persistProfileState();
  setStatus("success", "本地演示证明已生成", "下一步连接注入钱包，或使用模拟钱包继续测试签名流程。 ");
  render();
};

const handleMicrophone = async () => {
  clearError(elements["challenge-error"]);
  if (!state.challenge || isExpired(state.challenge)) {
    showError(elements["challenge-error"], new VoiceIDError("CHALLENGE_EXPIRED", "challenge", "挑战已过期，请生成新挑战。", true));
    return;
  }

  state.sampling = true;
  state.challenge.status = "sampling";
  const captureController = new AbortController();
  state.captureController = captureController;
  setStatus("working", "正在进行本地采样", "请清晰念出屏幕中的 6 位数字。原始音频不会被保存。 ");
  render();

  try {
    const quality = await sampleMicrophone({
      signal: captureController.signal,
      onLevel: ({ elapsedMs, progress, rms }) => {
        const level = Math.min(Math.max(rms * 8, progress * 0.12), 1);
        elements["level-fill"].style.transform = `scaleX(${level.toFixed(3)})`;
        elements["level-track"].setAttribute("aria-valuenow", String(Math.round(level * 100)));
        elements["sampling-copy"].textContent = `本地采样 ${Math.min(elapsedMs / 1000, 4.2).toFixed(1)} / 4.2 秒`;
      },
    });
    completeProof(quality);
  } catch (error) {
    if (state.captureController !== captureController) return;
    if (state.challenge) state.challenge.status = "issued";
    showError(elements["challenge-error"], error);
  } finally {
    if (state.captureController !== captureController) return;
    state.sampling = false;
    state.captureController = null;
    elements["level-fill"].style.transform = "scaleX(0)";
    elements["level-track"].setAttribute("aria-valuenow", "0");
    if (!state.proof) elements["sampling-copy"].textContent = "采样未完成，可重试或使用演示输入";
    render();
  }
};

const handleDemoAudio = () => {
  clearError(elements["challenge-error"]);
  try {
    completeProof(createDemoAudioQuality());
    elements["sampling-copy"].textContent = "已使用模拟音频质量指标";
  } catch (error) {
    showError(elements["challenge-error"], error);
  }
};

const updateProfileRecovery = (method) => {
  state.profile.recoveryMethod = method;
  state.profile.updatedAt = new Date().toISOString();
  safeStore(STORAGE.profile, state.profile);
  elements["recovery-status"].textContent = `已完成格式演示：${method}。输入未保存。`;
  setStatus("success", "回退路径格式已验证", "该操作只更新当前演示档案，不生成或恢复真实密钥。 ");
  render();
};

const handlePin = (event) => {
  event.preventDefault();
  clearError(elements["recovery-error"]);
  const value = elements["pin-input"].value;
  elements["pin-input"].value = "";
  if (!state.profile || !/^\d{6}$/.test(value)) {
    showError(elements["recovery-error"], new VoiceIDError("RECOVERY_INVALID", "recovery", "PIN 演示只接受 6 位数字。", true));
    return;
  }
  updateProfileRecovery("pin-demo");
};

const handleRecoveryKey = (event) => {
  event.preventDefault();
  clearError(elements["recovery-error"]);
  const value = elements["recovery-input"].value.trim().toUpperCase();
  elements["recovery-input"].value = "";
  if (!state.profile || !/^VOICE-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(value)) {
    showError(
      elements["recovery-error"],
      new VoiceIDError("RECOVERY_INVALID", "recovery", "恢复密钥演示格式必须为 VOICE-XXXX-XXXX。", true),
    );
    return;
  }
  updateProfileRecovery("recovery-key-demo");
};

const bindWallet = ({ provider, binding }) => {
  state.unsubscribeProvider();
  state.provider = provider;
  state.wallet = binding;
  state.profile.walletBindingId = binding.id;
  state.profile.updatedAt = new Date().toISOString();
  state.signingRequest = createSigningRequest({ binding, proof: state.proof });
  state.session = null;
  state.signature = null;

  if (provider) {
    state.unsubscribeProvider = subscribeProvider(provider, (message) => {
      state.provider = null;
      state.wallet = null;
      state.signingRequest = null;
      state.session = null;
      state.signature = null;
      state.profile.walletBindingId = null;
      safeStore(STORAGE.wallet, null);
      safeStore(STORAGE.session, null);
      safeStore(STORAGE.profile, state.profile);
      showError(elements["wallet-error"], new VoiceIDError("WALLET_UNAVAILABLE", "wallet", message, true));
      render();
    });
  }

  persistProfileState();
  clearError(elements["wallet-error"]);
  setStatus(
    "success",
    binding.mode === "simulated" ? "模拟钱包已连接" : "注入钱包已连接",
    "请阅读签名消息。该请求不包含交易或资产授权。 ",
  );
  render();
};

const handleInjectedWallet = async () => {
  clearError(elements["wallet-error"]);
  try {
    setStatus("working", "等待钱包授权", "请在钱包中核对账户连接请求。 ");
    bindWallet(await connectInjectedWallet());
  } catch (error) {
    showError(elements["wallet-error"], error);
  }
};

const handleDemoWallet = () => {
  clearError(elements["wallet-error"]);
  try {
    bindWallet(createSimulatedWallet());
  } catch (error) {
    showError(elements["wallet-error"], error);
  }
};

const handleSignature = async () => {
  clearError(elements["wallet-error"]);
  try {
    if (!state.signingRequest || isExpired(state.signingRequest)) {
      state.signingRequest = createSigningRequest({ binding: state.wallet, proof: state.proof });
      render();
    }
    setStatus("working", "等待测试签名", "请核对 domain、nonce、过期时间和 VoiceProof request ID。 ");
    const result = await signRequest({
      provider: state.provider,
      binding: state.wallet,
      request: state.signingRequest,
    });
    state.signature = result.signature;
    state.session = createAuthSession({
      profile: state.profile,
      proof: state.proof,
      binding: state.wallet,
      request: state.signingRequest,
      signatureMode: result.mode,
    });
    safeStore(STORAGE.session, state.session);
    setStatus("success", "Playground 会话已生成", "签名已返回，但 serverVerified 仍为 false；页面未进行服务端验签。 ");
    render();
    document.getElementById("session-step").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError(elements["wallet-error"], error);
    render();
  }
};

const copySession = async () => {
  if (!state.session) return;
  const original = "复制会话摘要";
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.session, null, 2));
    elements["copy-session"].textContent = "已复制摘要";
  } catch {
    elements["copy-session"].textContent = "复制失败";
  }
  window.setTimeout(() => {
    elements["copy-session"].textContent = original;
  }, 1400);
};

const restoreSessionState = () => {
  const proof = safeRead(STORAGE.proof);
  const profile = safeRead(STORAGE.profile);
  const wallet = safeRead(STORAGE.wallet);
  const session = safeRead(STORAGE.session);

  if (!proof || !profile || proof.type !== "VoiceProof" || profile.type !== "IdentityProfile" || isExpired(proof)) {
    clearStorage();
    state.challenge = createChallenge();
    return;
  }

  state.proof = proof;
  state.profile = profile;
  state.audioQuality = proof.audioQuality || null;

  if (wallet?.type === "WalletBinding" && wallet.mode === "simulated") {
    state.wallet = wallet;
    state.signingRequest = createSigningRequest({ binding: wallet, proof });
  } else if (wallet) {
    safeStore(STORAGE.wallet, null);
    state.profile.walletBindingId = null;
  }

  if (session?.type === "AuthSession" && !isExpired(session) && session.voiceProofId === proof.id) {
    state.session = session;
  } else {
    safeStore(STORAGE.session, null);
  }

  setStatus("info", "已恢复当前标签会话", "签名字符串不会恢复；真实钱包需要重新连接。 ");
};

const resetSession = () => {
  clearDownstream();
  state.challenge = createChallenge();
  elements["pin-input"].value = "";
  elements["recovery-input"].value = "";
  elements["level-fill"].style.transform = "scaleX(0)";
  elements["level-track"].setAttribute("aria-valuenow", "0");
  elements["sampling-copy"].textContent = "尚未访问麦克风";
  setStatus("info", "会话已重置", "所有内存状态和 sessionStorage Playground 键均已清空。 ");
  render();
};

elements["start-microphone"].addEventListener("click", handleMicrophone);
elements["use-demo-audio"].addEventListener("click", handleDemoAudio);
elements["new-challenge"].addEventListener("click", issueChallenge);
elements["pin-form"].addEventListener("submit", handlePin);
elements["recovery-form"].addEventListener("submit", handleRecoveryKey);
elements["connect-wallet"].addEventListener("click", handleInjectedWallet);
elements["use-demo-wallet"].addEventListener("click", handleDemoWallet);
elements["sign-message"].addEventListener("click", handleSignature);
elements["copy-session"].addEventListener("click", copySession);
elements["reset-session"].addEventListener("click", resetSession);

window.addEventListener("pagehide", () => {
  state.captureController?.abort();
  state.unsubscribeProvider();
});

window.setInterval(() => {
  if (state.challenge && isExpired(state.challenge) && !state.sampling && !state.proof) {
    state.challenge.status = "expired";
    showError(elements["challenge-error"], new VoiceIDError("CHALLENGE_EXPIRED", "challenge", "挑战已过期，请生成新挑战。", true));
    render();
  } else if (state.challenge || state.proof) {
    renderChallenge();
  }
}, 1000);

restoreSessionState();
render();
