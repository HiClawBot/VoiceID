import { VoiceIDError, createId, isExpired } from "./voice-proof.js";

const SIGNING_TTL_MS = 5 * 60 * 1000;
const NONCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const randomHex = (bytes) => {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
};

export const createNonce = (length = 12) => {
  let result = "";
  while (result.length < length) {
    const values = crypto.getRandomValues(new Uint8Array(length));
    for (const value of values) {
      if (value >= 252) continue;
      result += NONCE_ALPHABET[value % NONCE_ALPHABET.length];
      if (result.length === length) break;
    }
  }
  return result;
};

const normalizeChainId = (chainId) => {
  if (typeof chainId !== "string") return "unknown";
  if (chainId.startsWith("0x")) return String(Number.parseInt(chainId, 16));
  return chainId;
};

const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value || "");

const providerError = (error, stage) => {
  if (error?.code === 4001) {
    const code = stage === "signature" ? "SIGNATURE_REJECTED" : "WALLET_REJECTED";
    const message = stage === "signature" ? "用户拒绝了测试签名。" : "用户拒绝了钱包连接。";
    return new VoiceIDError(code, stage, message, true);
  }
  const code = stage === "signature" ? "SIGNATURE_FAILED" : "WALLET_UNAVAILABLE";
  const message = stage === "signature" ? "钱包没有返回有效签名。" : "钱包 Provider 请求失败。";
  return new VoiceIDError(code, stage, message, true);
};

export const getInjectedProvider = () => {
  const provider = window.ethereum;
  return provider && typeof provider.request === "function" ? provider : null;
};

export const connectInjectedWallet = async () => {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new VoiceIDError("WALLET_MISSING", "wallet", "未检测到注入钱包，可使用模拟钱包继续。", true);
  }

  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const chainId = await provider.request({ method: "eth_chainId" });
    const address = Array.isArray(accounts) ? accounts[0] : null;
    if (!isAddress(address)) throw new Error("No valid account returned");

    return {
      provider,
      binding: {
        id: createId("wb"),
        type: "WalletBinding",
        version: "0.1",
        mode: "eip1193",
        address,
        chainId: normalizeChainId(chainId),
        connectedAt: new Date().toISOString(),
        providerVerified: true,
      },
    };
  } catch (error) {
    throw providerError(error, "wallet");
  }
};

export const createSimulatedWallet = () => ({
  provider: null,
  binding: {
    id: createId("wb"),
    type: "WalletBinding",
    version: "0.1",
    mode: "simulated",
    address: `0x${randomHex(20)}`,
    chainId: "11155111",
    connectedAt: new Date().toISOString(),
    providerVerified: false,
  },
});

export const createSigningRequest = ({ binding, proof }) => {
  if (!binding || !proof || isExpired(proof)) {
    throw new VoiceIDError("SESSION_EXPIRED", "signature", "VoiceProof 已过期，请重新完成挑战。", true);
  }

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + SIGNING_TTL_MS);
  const nonce = createNonce();
  const domain = window.location.host;
  const uri = `${window.location.origin}${window.location.pathname}`;
  const message = `${domain} wants you to sign in with your Ethereum account:
${binding.address}

VoiceID Browser Beta demo. This request does not authorize transactions.

URI: ${uri}
Version: 1
Chain ID: ${binding.chainId}
Nonce: ${nonce}
Issued At: ${issuedAt.toISOString()}
Expiration Time: ${expiresAt.toISOString()}
Request ID: ${proof.id}
Resources:
- urn:voiceid:proof:${proof.id}`;

  return {
    nonce,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    message,
  };
};

const textToHex = (text) => {
  const bytes = new TextEncoder().encode(text);
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
};

export const signRequest = async ({ provider, binding, request }) => {
  if (!request || isExpired(request)) {
    throw new VoiceIDError("SESSION_EXPIRED", "signature", "签名请求已过期，请重新生成。", true);
  }

  if (binding.mode === "simulated") {
    return {
      mode: "simulated",
      signature: `sim_${randomHex(32)}`,
    };
  }

  if (!provider) {
    throw new VoiceIDError("WALLET_UNAVAILABLE", "wallet", "钱包 Provider 已断开。", true);
  }

  try {
    const signature = await provider.request({
      method: "personal_sign",
      params: [textToHex(request.message), binding.address],
    });
    if (typeof signature !== "string" || !signature.startsWith("0x")) throw new Error("Invalid signature");
    return { mode: "wallet", signature };
  } catch (error) {
    throw providerError(error, "signature");
  }
};

export const subscribeProvider = (provider, onInvalidated) => {
  if (!provider || typeof provider.on !== "function") return () => {};
  const handleAccounts = () => onInvalidated("钱包账户已变化，请重新连接并签名。");
  const handleChain = () => onInvalidated("钱包网络已变化，请重新连接并签名。");
  provider.on("accountsChanged", handleAccounts);
  provider.on("chainChanged", handleChain);

  return () => {
    if (typeof provider.removeListener !== "function") return;
    provider.removeListener("accountsChanged", handleAccounts);
    provider.removeListener("chainChanged", handleChain);
  };
};

export const createAuthSession = ({ profile, proof, binding, request, signatureMode }) => {
  if (!profile || !proof || !binding || !request || isExpired(proof) || isExpired(request)) {
    throw new VoiceIDError("SESSION_EXPIRED", "signature", "会话材料已过期，请重新开始。", true);
  }

  return {
    id: createId("as"),
    type: "AuthSession",
    version: "0.1",
    profileId: profile.id,
    voiceProofId: proof.id,
    walletBindingId: binding.id,
    scope: ["login", "wallet:sign"],
    nonce: request.nonce,
    issuedAt: request.issuedAt,
    expiresAt: request.expiresAt,
    signatureMode,
    status: "signed-demo",
    serverVerified: false,
  };
};
