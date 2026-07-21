import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { createOpaqueToken, hashValue } from "../crypto.js";
import { createDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { PostgresAuthRepository } from "../repository.js";

try {
	process.loadEnvFile();
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? undefined : process.argv[index + 1];
}

function requiredArgument(name: string): string {
	const value = argument(name)?.trim();
	if (!value) throw new Error(`--${name} is required`);
	return value;
}

const label = requiredArgument("label");
const issuedBy = requiredArgument("issued-by");
const expiresInHours = Number(argument("expires-in-hours") ?? "72");

if (label.length > 80)
	throw new Error("--label must contain at most 80 characters");
if (issuedBy.length > 80)
	throw new Error("--issued-by must contain at most 80 characters");
if (
	!Number.isInteger(expiresInHours) ||
	expiresInHours < 1 ||
	expiresInHours > 720
) {
	throw new Error("--expires-in-hours must be an integer from 1 to 720");
}

const config = loadConfig();
const sql = createDatabase(config.databaseUrl);
const repository = new PostgresAuthRepository(sql);
const code = `VOICEID-${createOpaqueToken(24)}`;
const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

try {
	await runMigrations(sql);
	await repository.seedInvitation({
		id: randomUUID(),
		codeHash: hashValue("invitation", code, config.tokenPepper),
		label,
		issuedBy,
		expiresAt,
	});
	await repository.recordAudit({
		eventType: "invitation.issued",
		result: "success",
		reason: "operator-cli",
	});
	process.stdout.write(
		`${[
			"Invitation issued. Copy the code now; it cannot be recovered from PostgreSQL.",
			`Code: ${code}`,
			`Label: ${label}`,
			`Issued by: ${issuedBy}`,
			`Expires: ${expiresAt.toISOString()}`,
		].join("\n")}\n`,
	);
} finally {
	await repository.close();
}
