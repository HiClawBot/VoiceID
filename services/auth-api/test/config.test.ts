import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const productionEnv: NodeJS.ProcessEnv = {
	NODE_ENV: "production",
	DATABASE_URL: "postgres://db.internal/voiceid?sslmode=verify-full",
	EXPECTED_ORIGIN: "https://auth.voiceid.example",
	RP_ID: "voiceid.example",
	RP_NAME: "VoiceID",
	TOKEN_PEPPER: "a-production-secret-with-more-than-32-characters",
	COOKIE_SECURE: "true",
	DATA_REGION: "eu-west-1",
	TRUST_PROXY: "10.0.0.0/8",
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

	it("requires verified database TLS, a data region, and a bounded trusted proxy", () => {
		expect(() =>
			loadConfig({
				...productionEnv,
				DATABASE_URL: "postgres://db.internal/voiceid?sslmode=require",
			}),
		).toThrow(/sslmode=verify-full/u);
		expect(() =>
			loadConfig({ ...productionEnv, DATA_REGION: undefined }),
		).toThrow(/DATA_REGION/u);
		expect(() =>
			loadConfig({ ...productionEnv, TRUST_PROXY: "0.0.0.0/0" }),
		).toThrow(/TRUST_PROXY/u);
	});

	it("loads deployed secrets from files and rejects ambiguous sources", () => {
		const directory = mkdtempSync(join(tmpdir(), "voiceid-config-"));
		const databaseFile = join(directory, "database-url");
		const pepperFile = join(directory, "token-pepper");
		writeFileSync(
			databaseFile,
			"postgres://db.internal/voiceid?sslmode=verify-full\n",
		);
		writeFileSync(pepperFile, "a-file-secret-with-more-than-32-characters\n");
		try {
			const fromFiles = {
				...productionEnv,
				DATABASE_URL: undefined,
				TOKEN_PEPPER: undefined,
				DATABASE_URL_FILE: databaseFile,
				TOKEN_PEPPER_FILE: pepperFile,
			};
			expect(loadConfig(fromFiles).databaseUrl).toContain("db.internal");
			expect(() =>
				loadConfig({ ...fromFiles, TOKEN_PEPPER: "x".repeat(40) }),
			).toThrow(/cannot both be set/u);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("loads safe localhost defaults for development only", () => {
		const config = loadConfig({ NODE_ENV: "development" });
		expect(config.expectedOrigin).toBe("http://localhost:5173");
		expect(config.rpId).toBe("localhost");
		expect(config.cookieSecure).toBe(false);
	});
});
