import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

async function createActiveAccount(suffix: string) {
	const now = new Date();
	const invitationCode = `VOICEID-${suffix}-INVITE`;
	const registrationToken = `registration-${suffix}`;
	const rawSessionToken = `session-${suffix}`;
	const userId = randomUUID();
	const credentialId = `credential-${suffix}-primary`;
	const registrationIntentHash = hashValue(
		"registration",
		registrationToken,
		pepper,
	);
	await repository.seedInvitation({
		id: randomUUID(),
		codeHash: hashValue("invitation", invitationCode, pepper),
		label: `Invitation ${suffix}`,
		issuedBy: "integration-test",
		expiresAt: new Date(now.getTime() + 60_000),
	});
	await repository.redeemInvitation({
		invitationHash: hashValue("invitation", invitationCode, pepper),
		userId,
		webauthnUserId: Uint8Array.from(randomBytes(32)),
		displayName: `User ${suffix}`,
		registrationIntentId: randomUUID(),
		registrationIntentHash,
		registrationExpiresAt: new Date(now.getTime() + 60_000),
		now,
	});
	await repository.completeRegistration({
		registrationIntentHash,
		credential: {
			id: credentialId,
			userId,
			label: "Primary Passkey",
			publicKey: Uint8Array.from(randomBytes(64)),
			counter: 0,
			transports: ["internal"],
			deviceType: "singleDevice",
			backedUp: false,
			createdAt: now,
		},
		session: {
			id: randomUUID(),
			tokenHash: hashValue("session", rawSessionToken, pepper),
			userId,
			idleExpiresAt: new Date(now.getTime() + 60_000),
			absoluteExpiresAt: new Date(now.getTime() + 120_000),
		},
		now,
	});
	return { now, userId, credentialId, rawSessionToken };
}

describe("PostgresAuthRepository", () => {
	beforeAll(async () => {
		await runMigrations(sql);
	});

	beforeEach(async () => {
		await sql.unsafe(`
			TRUNCATE audit_events, consent_records, security_confirmations, auth_sessions,
				auth_credentials, auth_challenges, registration_intents, invitations, users CASCADE
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
			issuedBy: "integration-test",
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
				label: "Primary Passkey",
				publicKey: Uint8Array.from(randomBytes(64)),
				counter: 0,
				transports: ["internal"],
				deviceType: "singleDevice",
				backedUp: false,
				createdAt: now,
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

	it("purpose-binds confirmations and enforces recovery-safe revocation and deletion", async () => {
		const account = await createActiveAccount("lifecycle");
		const additionToken = "confirmation-addition";
		const expiredToken = "confirmation-expired";

		await repository.completeSecurityConfirmation({
			credentialId: account.credentialId,
			expectedCounter: 0,
			newCounter: 0,
			backedUp: false,
			confirmation: {
				id: randomUUID(),
				tokenHash: hashValue("confirmation", expiredToken, pepper),
				userId: account.userId,
				scope: "credential_add",
				expiresAt: new Date(account.now.getTime() - 1),
			},
			now: account.now,
		});
		await expect(
			repository.prepareCredentialAddition({
				userId: account.userId,
				confirmationHash: hashValue("confirmation", expiredToken, pepper),
				now: account.now,
			}),
		).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });

		await repository.completeSecurityConfirmation({
			credentialId: account.credentialId,
			expectedCounter: 0,
			newCounter: 0,
			backedUp: false,
			confirmation: {
				id: randomUUID(),
				tokenHash: hashValue("confirmation", additionToken, pepper),
				userId: account.userId,
				scope: "credential_add",
				expiresAt: new Date(account.now.getTime() + 60_000),
			},
			now: account.now,
		});
		const prepared = await repository.prepareCredentialAddition({
			userId: account.userId,
			confirmationHash: hashValue("confirmation", additionToken, pepper),
			now: account.now,
		});
		expect(prepared.credentials).toHaveLength(1);
		await expect(
			repository.prepareCredentialAddition({
				userId: account.userId,
				confirmationHash: hashValue("confirmation", additionToken, pepper),
				now: account.now,
			}),
		).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });

		const backupCredentialId = "credential-lifecycle-backup";
		await repository.completeCredentialAddition({
			credential: {
				id: backupCredentialId,
				userId: account.userId,
				label: "Backup Passkey",
				publicKey: Uint8Array.from(randomBytes(64)),
				counter: 0,
				transports: ["internal"],
				deviceType: "multiDevice",
				backedUp: true,
				createdAt: account.now,
			},
			now: account.now,
		});
		await expect(
			repository.listCredentials(account.userId),
		).resolves.toHaveLength(2);

		const revokeToken = "confirmation-revoke";
		await repository.completeSecurityConfirmation({
			credentialId: account.credentialId,
			expectedCounter: 0,
			newCounter: 0,
			backedUp: false,
			confirmation: {
				id: randomUUID(),
				tokenHash: hashValue("confirmation", revokeToken, pepper),
				userId: account.userId,
				scope: "credential_revoke",
				expiresAt: new Date(account.now.getTime() + 60_000),
			},
			now: account.now,
		});
		await expect(
			repository.deleteAccount({
				userId: account.userId,
				confirmationHash: hashValue("confirmation", revokeToken, pepper),
				now: account.now,
			}),
		).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
		await repository.revokeCredential({
			userId: account.userId,
			credentialId: backupCredentialId,
			confirmationHash: hashValue("confirmation", revokeToken, pepper),
			now: account.now,
		});
		await expect(
			repository.listCredentials(account.userId),
		).resolves.toHaveLength(1);
		await expect(
			repository.findAndTouchSession(
				hashValue("session", account.rawSessionToken, pepper),
				account.now,
				new Date(account.now.getTime() + 90_000),
			),
		).resolves.toBeNull();

		const lastCredentialToken = "confirmation-last-credential";
		await repository.completeSecurityConfirmation({
			credentialId: account.credentialId,
			expectedCounter: 0,
			newCounter: 0,
			backedUp: false,
			confirmation: {
				id: randomUUID(),
				tokenHash: hashValue("confirmation", lastCredentialToken, pepper),
				userId: account.userId,
				scope: "credential_revoke",
				expiresAt: new Date(account.now.getTime() + 60_000),
			},
			now: account.now,
		});
		await expect(
			repository.revokeCredential({
				userId: account.userId,
				credentialId: account.credentialId,
				confirmationHash: hashValue(
					"confirmation",
					lastCredentialToken,
					pepper,
				),
				now: account.now,
			}),
		).rejects.toMatchObject({ code: "LAST_CREDENTIAL" });

		const deleteToken = "confirmation-delete";
		await repository.completeSecurityConfirmation({
			credentialId: account.credentialId,
			expectedCounter: 0,
			newCounter: 0,
			backedUp: false,
			confirmation: {
				id: randomUUID(),
				tokenHash: hashValue("confirmation", deleteToken, pepper),
				userId: account.userId,
				scope: "account_delete",
				expiresAt: new Date(account.now.getTime() + 60_000),
			},
			now: account.now,
		});
		await repository.deleteAccount({
			userId: account.userId,
			confirmationHash: hashValue("confirmation", deleteToken, pepper),
			now: account.now,
		});
		await expect(repository.listCredentials(account.userId)).resolves.toEqual(
			[],
		);
		const [deleted] = await sql<
			{
				status: string;
				display_name: string;
				label: string;
				public_key_bytes: number;
			}[]
		>`
			SELECT u.status, u.display_name, c.label,
			       octet_length(c.public_key) AS public_key_bytes
			FROM users u
			JOIN auth_credentials c ON c.user_id = u.id
			WHERE u.id = ${account.userId}
			LIMIT 1
		`;
		expect(deleted).toMatchObject({
			status: "deleted",
			display_name: "Deleted account",
			label: "Deleted Passkey",
			public_key_bytes: 0,
		});
	});
});
