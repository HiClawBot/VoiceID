import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type HashPurpose =
	| "challenge"
	| "flow"
	| "invitation"
	| "confirmation"
	| "registration"
	| "session";

export function createOpaqueToken(bytes = 32): string {
	return randomBytes(bytes).toString("base64url");
}

export function hashValue(
	purpose: HashPurpose,
	value: string,
	pepper: string,
): Buffer {
	return createHmac("sha256", pepper)
		.update(`${purpose}\0${value}`, "utf8")
		.digest();
}

export function matchesHash(
	purpose: HashPurpose,
	value: string,
	expected: Uint8Array,
	pepper: string,
): boolean {
	const actual = hashValue(purpose, value, pepper);
	const expectedBuffer = Buffer.from(expected);
	return (
		actual.length === expectedBuffer.length &&
		timingSafeEqual(actual, expectedBuffer)
	);
}
