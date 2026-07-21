import postgres from "postgres";

export function createDatabase(databaseUrl: string) {
	return postgres(databaseUrl, {
		max: 10,
		idle_timeout: 20,
		connect_timeout: 10,
		prepare: true,
	});
}

export type Database = ReturnType<typeof createDatabase>;
