const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const PROOF_TTL_MS = 5 * 60 * 1000;
const SAMPLE_DURATION_MS = 4200;
const MIN_DURATION_MS = 2500;
const MIN_RMS = 0.015;
const MAX_CLIPPING_RATIO = 0.05;

export class VoiceIDError extends Error {
  constructor(code, stage, message, recoverable = true) {
    super(message);
    this.name = "VoiceIDError";
    this.code = code;
    this.stage = stage;
    this.recoverable = recoverable;
    this.createdAt = new Date().toISOString();
  }

  toJSON() {
    return {
      code: this.code,
      stage: this.stage,
      message: this.message,
      recoverable: this.recoverable,
      createdAt: this.createdAt,
    };
  }
}

const randomHex = (bytes = 4) => {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
};

export const createId = (prefix) => `${prefix}_${randomHex(4)}`;

const randomDigits = (length) => {
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (value) => String(value % 10)).join("");
};

export const isExpired = (value) => !value?.expiresAt || Date.parse(value.expiresAt) <= Date.now();

export const createChallenge = () => {
  const createdAt = new Date();
  return {
    id: createId("vc"),
    type: "VoiceChallenge",
    version: "0.1",
    phrase: randomDigits(6),
    purpose: "local-presence-demo",
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + CHALLENGE_TTL_MS).toISOString(),
    status: "issued",
  };
};

export const createDemoAudioQuality = () => ({
  durationMs: 4176,
  rms: 0.072,
  peak: 0.584,
  clippingRatio: 0.002,
  quality: "good",
  source: "simulated-input",
});

export const classifyAudioQuality = ({ durationMs, rms, clippingRatio }) => {
  if (durationMs < MIN_DURATION_MS) return "too-short";
  if (rms < MIN_RMS) return "too-quiet";
  if (clippingRatio > MAX_CLIPPING_RATIO) return "clipping";
  return "good";
};

const mapMediaError = (error) => {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return new VoiceIDError("MIC_DENIED", "microphone", "麦克风权限被拒绝。请重试或使用演示输入。", true);
  }
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return new VoiceIDError("MIC_NOT_FOUND", "microphone", "未找到可用的音频输入设备。", true);
  }
  if (error?.name === "AbortError" || error?.name === "NotReadableError") {
    return new VoiceIDError("MIC_ABORTED", "microphone", "浏览器或设备中止了本次采样。", true);
  }
  if (error instanceof VoiceIDError) return error;
  return new VoiceIDError("MIC_UNAVAILABLE", "microphone", "当前浏览器无法完成麦克风采样。", false);
};

export const sampleMicrophone = async ({ signal, onLevel }) => {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new VoiceIDError(
      "MIC_UNAVAILABLE",
      "microphone",
      "麦克风需要 HTTPS 或 localhost 安全上下文。",
      false,
    );
  }

  let stream;
  let audioContext;
  let source;
  let analyser;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new VoiceIDError("MIC_UNAVAILABLE", "microphone", "当前浏览器不支持 Web Audio。", false);
    }

    audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") await audioContext.resume();

    source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    const startedAt = performance.now();
    let squaredTotal = 0;
    let sampleTotal = 0;
    let clippedTotal = 0;
    let peak = 0;

    const result = await new Promise((resolve, reject) => {
      let animationFrame = 0;

      const finish = (value, error) => {
        cancelAnimationFrame(animationFrame);
        signal?.removeEventListener("abort", handleAbort);
        if (error) reject(error);
        else resolve(value);
      };

      const handleAbort = () => {
        finish(null, new VoiceIDError("MIC_ABORTED", "microphone", "采样已取消。", true));
      };

      const readFrame = (now) => {
        if (signal?.aborted) {
          handleAbort();
          return;
        }

        analyser.getFloatTimeDomainData(samples);
        let frameSquares = 0;

        for (const sample of samples) {
          const absolute = Math.abs(sample);
          frameSquares += sample * sample;
          squaredTotal += sample * sample;
          sampleTotal += 1;
          if (absolute >= 0.98) clippedTotal += 1;
          if (absolute > peak) peak = absolute;
        }

        const elapsed = now - startedAt;
        const frameRms = Math.sqrt(frameSquares / samples.length);
        onLevel?.({
          elapsedMs: Math.round(elapsed),
          progress: Math.min(elapsed / SAMPLE_DURATION_MS, 1),
          rms: frameRms,
        });

        if (elapsed >= SAMPLE_DURATION_MS) {
          const durationMs = Math.round(elapsed);
          const rms = sampleTotal ? Math.sqrt(squaredTotal / sampleTotal) : 0;
          const clippingRatio = sampleTotal ? clippedTotal / sampleTotal : 0;
          finish({
            durationMs,
            rms: Number(rms.toFixed(4)),
            peak: Number(peak.toFixed(4)),
            clippingRatio: Number(clippingRatio.toFixed(4)),
            quality: classifyAudioQuality({ durationMs, rms, clippingRatio }),
            source: "microphone",
          });
          return;
        }

        animationFrame = requestAnimationFrame(readFrame);
      };

      signal?.addEventListener("abort", handleAbort, { once: true });
      animationFrame = requestAnimationFrame(readFrame);
    });

    return result;
  } catch (error) {
    throw mapMediaError(error);
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    source?.disconnect();
    analyser?.disconnect();
    if (audioContext && audioContext.state !== "closed") await audioContext.close();
  }
};

export const createVoiceProof = (challenge, audioQuality) => {
  if (!challenge || isExpired(challenge)) {
    throw new VoiceIDError("CHALLENGE_EXPIRED", "challenge", "语音挑战已过期，请生成新挑战。", true);
  }

  const quality = classifyAudioQuality(audioQuality);
  if (quality === "too-short") {
    throw new VoiceIDError("MIC_TOO_SHORT", "microphone", "采样时间不足，请完整念出挑战数字。", true);
  }
  if (quality === "too-quiet") {
    throw new VoiceIDError("MIC_TOO_QUIET", "microphone", "输入音量过低，请靠近麦克风后重试。", true);
  }
  if (quality === "clipping") {
    throw new VoiceIDError("MIC_CLIPPING", "microphone", "输入削波过高，请降低音量后重试。", true);
  }

  const createdAt = new Date();
  challenge.status = "completed";
  return {
    id: createId("vp"),
    type: "VoiceProof",
    version: "0.1",
    challengeId: challenge.id,
    scope: ["login", "wallet:sign"],
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + PROOF_TTL_MS).toISOString(),
    method: "local-simulated-v0",
    assurance: "demo-only",
    status: "verified",
    audioQuality: { ...audioQuality, quality },
    rawAudioPersisted: false,
  };
};

export const createIdentityProfile = (proof) => {
  if (!proof || proof.status !== "verified" || isExpired(proof)) {
    throw new VoiceIDError("SESSION_EXPIRED", "profile", "VoiceProof 不可用，请重新完成挑战。", true);
  }

  const now = new Date().toISOString();
  return {
    id: createId("vid"),
    type: "IdentityProfile",
    version: "0.1",
    createdAt: now,
    updatedAt: now,
    voiceProofId: proof.id,
    walletBindingId: null,
    recoveryMethod: "none",
    storage: "session-only",
    localOnly: true,
  };
};
