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
	cookieSecure: boolean;
	devInviteCode?: string;
	challengeTtlMs: number;
	registrationIntentTtlMs: number;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	const environment = parseEnvironment(env.NODE_ENV);
	const rpId = required(env, "RP_ID", "localhost");
	const expectedOrigin = required(
		env,
		"EXPECTED_ORIGIN",
		"http://localhost:5173",
	);
	const tokenPepper = required(env, "TOKEN_PEPPER", DEV_PEPPER);
	const cookieSecure = parseBoolean(
		env.COOKIE_SECURE,
		environment !== "development" && environment !== "test",
	);
	const origin = validateOrigin(expectedOrigin, rpId);
	const databaseUrl = required(
		env,
		"DATABASE_URL",
		"postgres://localhost/voiceid_dev",
	);
	const databaseProtocol = new URL(databaseUrl).protocol;

	if (databaseProtocol !== "postgres:" && databaseProtocol !== "postgresql:") {
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
		sessionIdleTtlMs: 15 * 60 * 1000,
		sessionAbsoluteTtlMs: 8 * 60 * 60 * 1000,
	};
	if (env.DEV_INVITE_CODE) config.devInviteCode = env.DEV_INVITE_CODE;
	return config;
}
