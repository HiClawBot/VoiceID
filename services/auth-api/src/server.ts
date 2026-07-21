import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { PostgresAuthRepository } from "./repository.js";

try {
	process.loadEnvFile();
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const config = loadConfig();
const sql = createDatabase(config.databaseUrl);
await runMigrations(sql);
const repository = new PostgresAuthRepository(sql);
const app = await buildApp({ config, repository, logger: true });

const shutdown = async (signal: string) => {
	app.log.info({ signal }, "shutting down");
	await app.close();
	process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
	await app.listen({ host: config.host, port: config.port });
} catch (error) {
	app.log.error(error);
	await app.close();
	process.exit(1);
}
