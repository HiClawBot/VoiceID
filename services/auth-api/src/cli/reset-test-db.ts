import { loadConfig } from "../config.js";
import { createDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";

const config = loadConfig();
const databaseName = new URL(config.databaseUrl).pathname.slice(1);
if (config.environment !== "test" || !databaseName.endsWith("_test")) {
	throw new Error(
		`Refusing reset: NODE_ENV must be test and the database name must end with _test`,
	);
}

const sql = createDatabase(config.databaseUrl);
try {
	await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
	await runMigrations(sql);
	process.stdout.write(`Reset ${databaseName}\n`);
} finally {
	await sql.end();
}
