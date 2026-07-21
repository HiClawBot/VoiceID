import { loadConfig } from "../config.js";
import { createDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";

try {
	process.loadEnvFile();
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const config = loadConfig();
const sql = createDatabase(config.databaseUrl);

try {
	const applied = await runMigrations(sql);
	process.stdout.write(
		applied.length > 0
			? `Applied: ${applied.join(", ")}\n`
			: "Database is up to date\n",
	);
} finally {
	await sql.end();
}
