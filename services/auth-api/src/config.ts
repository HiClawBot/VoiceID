import { readFileSync } from "node:fs";

export type RuntimeEnvironment =
	| "development"
	| "test"
	| "staging"
	| "production";

export interface AppConfig {
	environment: RuntimeEnvironment;
	host: string;
	port: number;
	databaseUrl: string;
	expectedOrigin: string;
	rpId: string;
	rpName: string;
	tokenPepper: string;
	dataRegion?: string;
	trustProxy?: string[];
	cookieSecure: boolean;
	devInviteCode?: string;
	challengeTtlMs: number;
	registrationIntentTtlMs: number;
	securityConfirmationTtlMs: number;
	sessionIdleTtlMs: number;
	sessionAbsoluteTtlMs: number;
}

const DEV_PEPPER = "dev-only-change-before-production-32-bytes";

function required(
	env: NodeJS.ProcessEnv,
	key: string,
	fallback?: string,
): string {
	const value = env[key] ?? fallback;
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

function requiredSecret(
	env: NodeJS.ProcessEnv,
	key: "DATABASE_URL" | "TOKEN_PEPPER",
	fallback?: string,
): string {
	const fileKey = `${key}_FILE`;
	const directValue = env[key];
	const filePath = env[fileKey];
	if (directValue && filePath) {
		throw new Error(`${key} and ${fileKey} cannot both be set`);
	}
	if (filePath) {
		const value = readFileSync(filePath, "utf8").trim();
		if (!value) throw new Error(`${fileKey} must not be empty`);
		return value;
	}
	return required(env, key, fallback);
}

function parseEnvironment(value: string | undefined): RuntimeEnvironment {
	const environment = value ?? "development";
	if (!["development", "test", "staging", "production"].includes(environment)) {
		throw new Error(
			`NODE_ENV must be development, test, staging, or production`,
		);
	}
	return environment as RuntimeEnvironment;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error(`Boolean environment values must be true or false`);
}

function parsePort(value: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`PORT must be an integer between 1 and 65535`);
	}
	return port;
}

function validateOrigin(originValue: string, rpId: string): URL {
	const origin = new URL(originValue);
	if (origin.origin !== originValue || origin.pathname !== "/") {
		throw new Error(
			`EXPECTED_ORIGIN must be an exact origin without a path or trailing slash`,
		);
	}
	const hostMatchesRp =
		origin.hostname === rpId || origin.hostname.endsWith(`.${rpId}`);
	if (!hostMatchesRp) {
		throw new Error(
			`RP_ID must equal or be a registrable suffix of EXPECTED_ORIGIN`,
		);
	}
	return origin;
}

function parseDatabaseUrl(value: string): URL {
	try {
		return new URL(value);
	} catch {
		throw new Error(`DATABASE_URL must be a valid PostgreSQL URL`);
	}
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	const environment = parseEnvironment(env.NODE_ENV);
	const rpId = required(env, "RP_ID", "localhost");
	const expectedOrigin = required(
		env,
		"EXPECTED_ORIGIN",
		"http://localhost:5173",
	);
	const tokenPepper = requiredSecret(env, "TOKEN_PEPPER", DEV_PEPPER);
	const cookieSecure = parseBoolean(
		env.COOKIE_SECURE,
		environment !== "development" && environment !== "test",
	);
	const origin = validateOrigin(expectedOrigin, rpId);
	const databaseUrl = requiredSecret(
		env,
		"DATABASE_URL",
		"postgres://localhost/voiceid_dev",
	);
	const database = parseDatabaseUrl(databaseUrl);

	if (database.protocol !== "postgres:" && database.protocol !== "postgresql:") {
		throw new Error(`DATABASE_URL must use postgres:// or postgresql://`);
	}
	if (tokenPepper.length < 32) {
		throw new Error(`TOKEN_PEPPER must contain at least 32 characters`);
	}
	const isDeployedEnvironment =
		environment === "staging" || environment === "production";
	if (isDeployedEnvironment && env.DEV_INVITE_CODE) {
		throw new Error(
			`DEV_INVITE_CODE is forbidden outside development and test`,
		);
	}
	if (isDeployedEnvironment) {
		if (origin.protocol !== "https:")
			throw new Error(`Deployed EXPECTED_ORIGIN must use HTTPS`);
		if (rpId === "localhost")
			throw new Error(`Deployed RP_ID cannot be localhost`);
		if (!cookieSecure) throw new Error(`Deployed cookies must be Secure`);
		if (tokenPepper === DEV_PEPPER || tokenPepper.includes("dev-only")) {
			throw new Error(`Deployed TOKEN_PEPPER cannot use a development value`);
		}
		if (["localhost", "127.0.0.1", "::1"].includes(database.hostname)) {
			throw new Error(`Deployed DATABASE_URL cannot use a loopback host`);
		}
		if (database.searchParams.get("sslmode") !== "verify-full") {
			throw new Error(`Deployed DATABASE_URL must set sslmode=verify-full`);
		}
		if (!env.DATA_REGION?.trim()) {
			throw new Error(`DATA_REGION is required in deployed environments`);
		}
		const trustProxy = env.TRUST_PROXY?.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
		if (!trustProxy?.length) {
			throw new Error(`TRUST_PROXY is required in deployed environments`);
		}
		if (
			trustProxy.some((value) =>
				["true", "*", "0.0.0.0/0", "::/0"].includes(value),
			)
		) {
			throw new Error(`TRUST_PROXY cannot trust every source`);
		}
	}

	const config: AppConfig = {
		environment,
		host: env.HOST ?? "127.0.0.1",
		port: parsePort(env.PORT ?? "3401"),
		databaseUrl,
		expectedOrigin,
		rpId,
		rpName: required(env, "RP_NAME", "VoiceID Online Beta"),
		tokenPepper,
		cookieSecure,
		challengeTtlMs: 5 * 60 * 1000,
		registrationIntentTtlMs: 10 * 60 * 1000,
		securityConfirmationTtlMs: 5 * 60 * 1000,
		sessionIdleTtlMs: 15 * 60 * 1000,
		sessionAbsoluteTtlMs: 8 * 60 * 60 * 1000,
	};
	if (env.DATA_REGION?.trim()) config.dataRegion = env.DATA_REGION.trim();
	const trustProxy = env.TRUST_PROXY?.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	if (trustProxy?.length) config.trustProxy = trustProxy;
	if (env.DEV_INVITE_CODE) config.devInviteCode = env.DEV_INVITE_CODE;
	return config;
}
