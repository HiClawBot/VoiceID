import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashValue } from "../src/crypto.js";
import { createDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { AppError } from "../src/errors.js";
import { PostgresAuthRepository } from "../src/repository.js";

const databaseUrl =
	process.env.TEST_DATABASE_URL ?? "postgres://localhost/voiceid_test";
const pepper = "repository-test-pepper-with-at-least-32-characters";
const sql = createDatabase(databaseUrl);
const repository = new PostgresAuthRepository(sql);

describe("PostgresAuthRepository", () => {
	beforeAll(async () => {
		await runMigrations(sql);
		await sql.unsafe(`
			TRUNCATE audit_events, consent_records, auth_sessions, auth_credentials,
				auth_challenges, registration_intents, invitations, users CASCADE
		`);
	});

	afterAll(async () => {
		await repository.close();
	});

	it("consumes an invitation and registration challenge only once, then revokes an opaque session", async () => {
		const now = new Date();
		const invitationCode = "VOICEID-REPOSITORY-TEST";
		const registrationToken = "registration-token";
		const flowToken = "registration-flow-token";
		const userId = randomUUID();
		const registrationIntentHash = hashValue(
			"registration",
			registrationToken,
			pepper,
		);

		await repository.seedInvitation({
			id: randomUUID(),
			codeHash: hashValue("invitation", invitationCode, pepper),
			label: "Repository integration test",
			expiresAt: new Date(now.getTime() + 60_000),
		});
		const user = await repository.redeemInvitation({
			invitationHash: hashValue("invitation", invitationCode, pepper),
			userId,
			webauthnUserId: Uint8Array.from(randomBytes(32)),
			displayName: "Repository Test",
			registrationIntentId: randomUUID(),
			registrationIntentHash,
			registrationExpiresAt: new Date(now.getTime() + 60_000),
			now,
		});
		expect(user.status).toBe("pending");

		await expect(
			repository.redeemInvitation({
				invitationHash: hashValue("invitation", invitationCode, pepper),
				userId: randomUUID(),
				webauthnUserId: Uint8Array.from(randomBytes(32)),
				displayName: "Replay",
				registrationIntentId: randomUUID(),
				registrationIntentHash: hashValue("registration", "other", pepper),
				registrationExpiresAt: new Date(now.getTime() + 60_000),
				now,
			}),
		).rejects.toMatchObject({ code: "INVITATION_INVALID" });

		await repository.createChallenge({
			id: randomUUID(),
			kind: "registration",
			userId,
			flowTokenHash: hashValue("flow", flowToken, pepper),
			challengeHash: hashValue("challenge", "signed-challenge", pepper),
			expiresAt: new Date(now.getTime() + 60_000),
		});

		const claims = await Promise.allSettled([
			repository.claimRegistrationChallenge({
				flowTokenHash: hashValue("flow", flowToken, pepper),
				registrationIntentHash,
				now,
			}),
			repository.claimRegistrationChallenge({
				flowTokenHash: hashValue("flow", flowToken, pepper),
				registrationIntentHash,
				now,
			}),
		]);
		expect(
			claims.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const rejected = claims.find((result) => result.status === "rejected");
		expect(rejected).toBeDefined();
		if (rejected?.status === "rejected") {
			expect(rejected.reason).toBeInstanceOf(AppError);
			expect((rejected.reason as AppError).code).toBe("CHALLENGE_INVALID");
		}

		const rawSessionToken = "raw-session-token-never-stored";
		const sessionId = randomUUID();
		const activeSession = await repository.completeRegistration({
			registrationIntentHash,
			credential: {
				id: "credential-id",
				userId,
				publicKey: Uint8Array.from(randomBytes(64)),
				counter: 0,
				transports: ["internal"],
				deviceType: "singleDevice",
				backedUp: false,
			},
			session: {
				id: sessionId,
				tokenHash: hashValue("session", rawSessionToken, pepper),
				userId,
				idleExpiresAt: new Date(now.getTime() + 60_000),
				absoluteExpiresAt: new Date(now.getTime() + 120_000),
			},
			now,
		});
		expect(activeSession.user.status).toBe("active");

		const [stored] = await sql<{ token_hex: string }[]>`
			SELECT encode(token_hash, 'hex') AS token_hex FROM auth_sessions WHERE id = ${sessionId}
		`;
		expect(stored?.token_hex).not.toContain(rawSessionToken);

		const sessionHash = hashValue("session", rawSessionToken, pepper);
		await expect(
			repository.findAndTouchSession(
				sessionHash,
				now,
				new Date(now.getTime() + 90_000),
			),
		).resolves.toMatchObject({ id: sessionId, assurance: "passkey" });
		await repository.revokeSession(sessionHash, now);
		await expect(
			repository.findAndTouchSession(
				sessionHash,
				now,
				new Date(now.getTime() + 90_000),
			),
		).resolves.toBeNull();

		const unknownCredentialFlow = "unknown-credential-flow";
		await repository.createChallenge({
			id: randomUUID(),
			kind: "authentication",
			flowTokenHash: hashValue("flow", unknownCredentialFlow, pepper),
			challengeHash: hashValue(
				"challenge",
				"unknown-credential-challenge",
				pepper,
			),
			expiresAt: new Date(now.getTime() + 60_000),
		});
		await expect(
			repository.claimAuthenticationChallenge({
				flowTokenHash: hashValue("flow", unknownCredentialFlow, pepper),
				credentialId: "unknown-credential",
				now,
			}),
		).rejects.toMatchObject({ code: "CREDENTIAL_NOT_FOUND" });
		await expect(
			repository.claimAuthenticationChallenge({
				flowTokenHash: hashValue("flow", unknownCredentialFlow, pepper),
				credentialId: "credential-id",
				now,
			}),
		).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
	});
});
