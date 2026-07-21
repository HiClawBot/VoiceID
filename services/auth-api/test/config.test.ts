import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const productionEnv: NodeJS.ProcessEnv = {
	NODE_ENV: "production",
	DATABASE_URL: "postgres://db.internal/voiceid",
	EXPECTED_ORIGIN: "https://auth.voiceid.example",
	RP_ID: "voiceid.example",
	RP_NAME: "VoiceID",
	TOKEN_PEPPER: "a-production-secret-with-more-than-32-characters",
	COOKIE_SECURE: "true",
};

describe("loadConfig", () => {
	it("accepts a complete production trust boundary", () => {
		const config = loadConfig(productionEnv);
		expect(config.environment).toBe("production");
		expect(config.cookieSecure).toBe(true);
		expect(config.rpId).toBe("voiceid.example");
	});

	it("rejects localhost in production", () => {
		expect(() =>
			loadConfig({
				...productionEnv,
				EXPECTED_ORIGIN: "http://localhost:5173",
				RP_ID: "localhost",
			}),
		).toThrow(/HTTPS|localhost/u);
	});

	it("rejects an RP ID outside the browser origin", () => {
		expect(() =>
			loadConfig({ ...productionEnv, RP_ID: "attacker.example" }),
		).toThrow(/RP_ID must equal/u);
	});

	it("rejects development invitations in staging", () => {
		expect(() =>
			loadConfig({
				...productionEnv,
				NODE_ENV: "staging",
				DEV_INVITE_CODE: "not-for-staging",
			}),
		).toThrow(/forbidden/u);
	});

	it("requires HTTPS and Secure cookies in staging", () => {
		expect(() =>
			loadConfig({
				...productionEnv,
				NODE_ENV: "staging",
				EXPECTED_ORIGIN: "http://auth.voiceid.example",
				COOKIE_SECURE: "false",
			}),
		).toThrow(/HTTPS|Secure/u);
	});

	it("loads safe localhost defaults for development only", () => {
		const config = loadConfig({ NODE_ENV: "development" });
		expect(config.expectedOrigin).toBe("http://localhost:5173");
		expect(config.rpId).toBe("localhost");
		expect(config.cookieSecure).toBe(false);
	});
});
