import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Database } from "./client.js";

const migrationsDirectory = fileURLToPath(
	new URL("../../migrations/", import.meta.url),
);

export async function runMigrations(sql: Database): Promise<string[]> {
	await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

	const filenames = (await readdir(migrationsDirectory))
		.filter((name) => name.endsWith(".sql"))
		.sort();
	const applied: string[] = [];

	for (const filename of filenames) {
		const [existing] = await sql<{ version: string }[]>`
      SELECT version FROM schema_migrations WHERE version = ${filename}
    `;
		if (existing) continue;

		const migration = await readFile(
			new URL(`../../migrations/${filename}`, import.meta.url),
			"utf8",
		);
		await sql.begin(async (transaction) => {
			await transaction.unsafe(migration);
			await transaction`INSERT INTO schema_migrations (version) VALUES (${filename})`;
		});
		applied.push(filename);
	}

	return applied;
}
