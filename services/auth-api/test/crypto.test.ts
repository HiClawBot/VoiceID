import { describe, expect, it } from "vitest";
import { createOpaqueToken, hashValue, matchesHash } from "../src/crypto.js";

const pepper = "test-pepper-with-at-least-thirty-two-characters";

describe("opaque token hashing", () => {
	it("creates URL-safe high-entropy tokens", () => {
		const first = createOpaqueToken();
		const second = createOpaqueToken();
		expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
		expect(second).not.toBe(first);
	});

	it("matches the correct purpose and value only", () => {
		const hash = hashValue("session", "raw-token", pepper);
		expect(matchesHash("session", "raw-token", hash, pepper)).toBe(true);
		expect(matchesHash("session", "another-token", hash, pepper)).toBe(false);
		expect(matchesHash("flow", "raw-token", hash, pepper)).toBe(false);
	});

	it("domain-separates identical values", () => {
		const challenge = hashValue("challenge", "same-value", pepper);
		const session = hashValue("session", "same-value", pepper);
		expect(challenge.equals(session)).toBe(false);
	});
});
