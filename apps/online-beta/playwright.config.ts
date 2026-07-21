import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const inheritedEnvironment = Object.fromEntries(
	Object.entries(process.env).filter(
		(entry): entry is [string, string] => entry[1] !== undefined,
	),
);

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 30_000,
	expect: { timeout: 8_000 },
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL: "http://localhost:5173",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "chrome-passkey",
			use: {
				...devices["Desktop Chrome"],
				...(process.env.CI ? {} : { channel: "chrome" }),
			},
		},
	],
	webServer: [
		{
			command: "npm run dev -w @voiceid/auth-api",
			cwd: repositoryRoot,
			env: {
				...inheritedEnvironment,
				NODE_ENV: "test",
				DATABASE_URL:
					process.env.TEST_DATABASE_URL ?? "postgres://localhost/voiceid_test",
				EXPECTED_ORIGIN: "http://localhost:5173",
				RP_ID: "localhost",
				RP_NAME: "VoiceID Online Beta",
				TOKEN_PEPPER: "e2e-token-pepper-with-more-than-32-characters",
				DEV_INVITE_CODE: "VOICEID-E2E-INVITE",
				HOST: "127.0.0.1",
				PORT: "3401",
			},
			url: "http://127.0.0.1:3401/readyz",
			reuseExistingServer: false,
			timeout: 30_000,
		},
		{
			command: "npm run dev -w @voiceid/online-beta",
			cwd: repositoryRoot,
			url: "http://localhost:5173",
			reuseExistingServer: false,
			timeout: 30_000,
		},
	],
});
