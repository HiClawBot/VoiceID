import { randomUUID } from "node:crypto";
import type {
	AuthenticatorTransportFuture,
	CredentialDeviceType,
} from "@simplewebauthn/server";
import type postgres from "postgres";
import { AppError } from "./errors.js";
import type {
	ActiveSession,
	AuditEvent,
	ChallengeKind,
	ClaimedChallenge,
	CredentialRecord,
	NewSecurityConfirmation,
	NewSession,
	SecurityConfirmationScope,
	UserRecord,
} from "./types.js";
import type { Database } from "./db/client.js";

interface UserRow {
	id: string;
	webauthn_user_id: Uint8Array;
	display_name: string;
	status: "pending" | "active";
	created_at: Date;
}

interface CredentialRow {
	credential_id: string;
	user_id: string;
	public_key: Uint8Array;
	counter: string | number;
	transports: AuthenticatorTransportFuture[];
	device_type: CredentialDeviceType;
	backed_up: boolean;
	label: string;
	credential_created_at: Date;
	credential_last_used_at: Date | null;
}

interface SessionRow extends UserRow {
	session_id: string;
	assurance: "passkey";
	idle_expires_at: Date;
	absolute_expires_at: Date;
}

function mapUser(row: UserRow): UserRecord {
	return {
		id: row.id,
		webauthnUserId: Uint8Array.from(row.webauthn_user_id),
		displayName: row.display_name,
		status: row.status,
		createdAt: row.created_at,
	};
}

function mapCredential(row: CredentialRow): CredentialRecord {
	return {
		id: row.credential_id,
		userId: row.user_id,
		label: row.label,
		publicKey: Uint8Array.from(row.public_key),
		counter: Number(row.counter),
		transports: row.transports,
		deviceType: row.device_type,
		backedUp: row.backed_up,
		createdAt: row.credential_created_at,
		...(row.credential_last_used_at
			? { lastUsedAt: row.credential_last_used_at }
			: {}),
	};
}

export interface AuthRepository {
	ping(): Promise<void>;
	seedInvitation(input: {
		id: string;
		codeHash: Uint8Array;
		label: string;
		issuedBy: string;
		expiresAt: Date;
	}): Promise<void>;
	redeemInvitation(input: {
		invitationHash: Uint8Array;
		userId: string;
		webauthnUserId: Uint8Array;
		displayName: string;
		registrationIntentId: string;
		registrationIntentHash: Uint8Array;
		registrationExpiresAt: Date;
		now: Date;
		requestId?: string;
	}): Promise<UserRecord>;
	getRegistrationUser(
		registrationIntentHash: Uint8Array,
		now: Date,
	): Promise<UserRecord>;
	createChallenge(input: {
		id: string;
		kind: ChallengeKind;
		userId?: string;
		flowTokenHash: Uint8Array;
		challengeHash: Uint8Array;
		scope?: SecurityConfirmationScope;
		expiresAt: Date;
	}): Promise<void>;
	claimRegistrationChallenge(input: {
		flowTokenHash: Uint8Array;
		registrationIntentHash: Uint8Array;
		now: Date;
	}): Promise<ClaimedChallenge>;
	claimAuthenticationChallenge(input: {
		flowTokenHash: Uint8Array;
		credentialId: string;
		now: Date;
	}): Promise<ClaimedChallenge>;
	claimSecurityConfirmationChallenge(input: {
		flowTokenHash: Uint8Array;
		userId: string;
		credentialId: string;
		now: Date;
	}): Promise<ClaimedChallenge>;
	completeSecurityConfirmation(input: {
		credentialId: string;
		expectedCounter: number;
		newCounter: number;
		backedUp: boolean;
		confirmation: NewSecurityConfirmation;
		now: Date;
		requestId?: string;
	}): Promise<void>;
	prepareCredentialAddition(input: {
		userId: string;
		confirmationHash: Uint8Array;
		now: Date;
	}): Promise<{ user: UserRecord; credentials: CredentialRecord[] }>;
	claimCredentialAdditionChallenge(input: {
		flowTokenHash: Uint8Array;
		userId: string;
		now: Date;
	}): Promise<ClaimedChallenge>;
	completeCredentialAddition(input: {
		credential: CredentialRecord;
		now: Date;
		requestId?: string;
	}): Promise<void>;
	listCredentials(userId: string): Promise<CredentialRecord[]>;
	revokeCredential(input: {
		userId: string;
		credentialId: string;
		confirmationHash: Uint8Array;
		now: Date;
		requestId?: string;
	}): Promise<void>;
	deleteAccount(input: {
		userId: string;
		confirmationHash: Uint8Array;
		now: Date;
		requestId?: string;
	}): Promise<void>;
	completeRegistration(input: {
		registrationIntentHash: Uint8Array;
		credential: CredentialRecord;
		session: NewSession;
		now: Date;
		requestId?: string;
	}): Promise<ActiveSession>;
	completeAuthentication(input: {
		credentialId: string;
		expectedCounter: number;
		newCounter: number;
		backedUp: boolean;
		session: NewSession;
		now: Date;
		requestId?: string;
	}): Promise<ActiveSession>;
	findAndTouchSession(
		tokenHash: Uint8Array,
		now: Date,
		nextIdleExpiry: Date,
	): Promise<ActiveSession | null>;
	revokeSession(
		tokenHash: Uint8Array,
		now: Date,
		requestId?: string,
	): Promise<void>;
	revokeAllSessions(
		userId: string,
		now: Date,
		requestId?: string,
	): Promise<void>;
	recordAudit(event: AuditEvent): Promise<void>;
	close(): Promise<void>;
}

export class PostgresAuthRepository implements AuthRepository {
	constructor(private readonly sql: Database) {}

	async ping(): Promise<void> {
		await this.sql`SELECT 1`;
	}

	async seedInvitation(input: {
		id: string;
		codeHash: Uint8Array;
		label: string;
		issuedBy: string;
		expiresAt: Date;
	}): Promise<void> {
		await this.sql`
	      INSERT INTO invitations (id, code_hash, label, issued_by, expires_at)
	      VALUES (
	        ${input.id},
	        ${Buffer.from(input.codeHash)},
	        ${input.label},
	        ${input.issuedBy},
	        ${input.expiresAt}
	      )
      ON CONFLICT (code_hash) DO NOTHING
    `;
	}

	async redeemInvitation(input: {
		invitationHash: Uint8Array;
		userId: string;
		webauthnUserId: Uint8Array;
		displayName: string;
		registrationIntentId: string;
		registrationIntentHash: Uint8Array;
		registrationExpiresAt: Date;
		now: Date;
		requestId?: string;
	}): Promise<UserRecord> {
		return this.sql.begin(async (transaction) => {
			const [invitation] = await transaction<{ id: string }[]>`
        SELECT id
        FROM invitations
        WHERE code_hash = ${Buffer.from(input.invitationHash)}
          AND consumed_at IS NULL
          AND expires_at > ${input.now}
        FOR UPDATE
      `;
			if (!invitation) {
				throw new AppError(
					"INVITATION_INVALID",
					400,
					"The invitation is invalid or expired",
				);
			}

			const [user] = await transaction<UserRow[]>`
        INSERT INTO users (id, webauthn_user_id, display_name, status)
        VALUES (${input.userId}, ${Buffer.from(input.webauthnUserId)}, ${input.displayName}, 'pending')
        RETURNING id, webauthn_user_id, display_name, status, created_at
      `;
			if (!user)
				throw new AppError(
					"INTERNAL_ERROR",
					500,
					"The account could not be created",
				);

			await transaction`
        UPDATE invitations
        SET consumed_at = ${input.now}, consumed_by = ${input.userId}
        WHERE id = ${invitation.id}
      `;
			await transaction`
        INSERT INTO registration_intents (id, user_id, token_hash, expires_at)
        VALUES (
          ${input.registrationIntentId},
          ${input.userId},
          ${Buffer.from(input.registrationIntentHash)},
          ${input.registrationExpiresAt}
        )
      `;
			await transaction`
        INSERT INTO audit_events (id, subject_user_id, event_type, result, request_id)
        VALUES (${randomUUID()}, ${input.userId}, 'invitation.redeemed', 'success', ${input.requestId ?? null})
      `;
			return mapUser(user);
		});
	}

	async getRegistrationUser(
		registrationIntentHash: Uint8Array,
		now: Date,
	): Promise<UserRecord> {
		const [row] = await this.sql<UserRow[]>`
      SELECT u.id, u.webauthn_user_id, u.display_name, u.status, u.created_at
      FROM registration_intents r
      JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ${Buffer.from(registrationIntentHash)}
        AND r.consumed_at IS NULL
        AND r.expires_at > ${now}
        AND u.status = 'pending'
    `;
		if (!row) {
			throw new AppError(
				"REGISTRATION_REQUIRED",
				401,
				"Redeem a valid invitation before registering a passkey",
			);
		}
		return mapUser(row);
	}

	async createChallenge(input: {
		id: string;
		kind: ChallengeKind;
		userId?: string;
		flowTokenHash: Uint8Array;
		challengeHash: Uint8Array;
		scope?: SecurityConfirmationScope;
		expiresAt: Date;
	}): Promise<void> {
		await this.sql`
	      INSERT INTO auth_challenges (
	        id, kind, user_id, flow_token_hash, challenge_hash, scope, expires_at
	      )
	      VALUES (
        ${input.id},
        ${input.kind},
        ${input.userId ?? null},
        ${Buffer.from(input.flowTokenHash)},
	        ${Buffer.from(input.challengeHash)},
	        ${input.scope ?? null},
	        ${input.expiresAt}
      )
    `;
	}

	async claimRegistrationChallenge(input: {
		flowTokenHash: Uint8Array;
		registrationIntentHash: Uint8Array;
		now: Date;
	}): Promise<ClaimedChallenge> {
		const claimed = await this.sql.begin(async (transaction) => {
			const [challenge] = await transaction<
				{ challenge_hash: Uint8Array; user_id: string }[]
			>`
        UPDATE auth_challenges
        SET consumed_at = ${input.now}
        WHERE flow_token_hash = ${Buffer.from(input.flowTokenHash)}
          AND kind = 'registration'
          AND consumed_at IS NULL
          AND expires_at > ${input.now}
        RETURNING challenge_hash, user_id
      `;
			if (!challenge?.user_id) {
				throw new AppError(
					"CHALLENGE_INVALID",
					400,
					"The registration challenge is invalid or expired",
				);
			}

			const [user] = await transaction<UserRow[]>`
        SELECT u.id, u.webauthn_user_id, u.display_name, u.status, u.created_at
        FROM registration_intents r
        JOIN users u ON u.id = r.user_id
        WHERE r.token_hash = ${Buffer.from(input.registrationIntentHash)}
          AND r.user_id = ${challenge.user_id}
          AND r.consumed_at IS NULL
          AND r.expires_at > ${input.now}
          AND u.status = 'pending'
        FOR UPDATE
      `;
			return { challengeHash: new Uint8Array(challenge.challenge_hash), user };
		});
		if (!claimed.user) {
			throw new AppError(
				"REGISTRATION_REQUIRED",
				401,
				"The registration authorization is invalid or expired",
			);
		}
		return {
			challengeHash: claimed.challengeHash,
			user: mapUser(claimed.user),
		};
	}

	async claimAuthenticationChallenge(input: {
		flowTokenHash: Uint8Array;
		credentialId: string;
		now: Date;
	}): Promise<ClaimedChallenge> {
		const claimed = await this.sql.begin(async (transaction) => {
			const [challenge] = await transaction<{ challenge_hash: Uint8Array }[]>`
        UPDATE auth_challenges
        SET consumed_at = ${input.now}
        WHERE flow_token_hash = ${Buffer.from(input.flowTokenHash)}
          AND kind = 'authentication'
          AND consumed_at IS NULL
          AND expires_at > ${input.now}
        RETURNING challenge_hash
      `;
			if (!challenge) {
				throw new AppError(
					"CHALLENGE_INVALID",
					400,
					"The authentication challenge is invalid or expired",
				);
			}

			const [row] = await transaction<(CredentialRow & UserRow)[]>`
        SELECT
          c.credential_id,
          c.user_id,
          c.public_key,
          c.counter,
	          c.transports,
	          c.device_type,
	          c.backed_up,
	          c.label,
	          c.created_at AS credential_created_at,
	          c.last_used_at AS credential_last_used_at,
          u.id,
          u.webauthn_user_id,
          u.display_name,
          u.status,
          u.created_at
        FROM auth_credentials c
        JOIN users u ON u.id = c.user_id
        WHERE c.credential_id = ${input.credentialId}
          AND c.revoked_at IS NULL
          AND u.status = 'active'
        FOR UPDATE
      `;
			return { challengeHash: new Uint8Array(challenge.challenge_hash), row };
		});
		if (!claimed.row) {
			throw new AppError(
				"CREDENTIAL_NOT_FOUND",
				400,
				"The passkey could not be verified",
			);
		}
		return {
			challengeHash: claimed.challengeHash,
			user: mapUser(claimed.row),
			credential: mapCredential(claimed.row),
		};
	}

	async claimSecurityConfirmationChallenge(input: {
		flowTokenHash: Uint8Array;
		userId: string;
		credentialId: string;
		now: Date;
	}): Promise<ClaimedChallenge> {
		const claimed = await this.sql.begin(async (transaction) => {
			const [challenge] = await transaction<
				{
					challenge_hash: Uint8Array;
					scope: SecurityConfirmationScope;
				}[]
			>`
        UPDATE auth_challenges
        SET consumed_at = ${input.now}
        WHERE flow_token_hash = ${Buffer.from(input.flowTokenHash)}
          AND kind = 'security_confirmation'
          AND user_id = ${input.userId}
          AND consumed_at IS NULL
          AND expires_at > ${input.now}
        RETURNING challenge_hash, scope
      `;
			if (!challenge) {
				throw new AppError(
					"CHALLENGE_INVALID",
					400,
					"The security confirmation is invalid or expired",
				);
			}

			const [row] = await transaction<(CredentialRow & UserRow)[]>`
        SELECT
          c.credential_id,
          c.user_id,
          c.public_key,
          c.counter,
          c.transports,
          c.device_type,
          c.backed_up,
          c.label,
          c.created_at AS credential_created_at,
          c.last_used_at AS credential_last_used_at,
          u.id,
          u.webauthn_user_id,
          u.display_name,
          u.status,
          u.created_at
        FROM auth_credentials c
        JOIN users u ON u.id = c.user_id
        WHERE c.credential_id = ${input.credentialId}
          AND c.user_id = ${input.userId}
          AND c.revoked_at IS NULL
          AND u.status = 'active'
        FOR UPDATE
      `;
			return {
				challengeHash: new Uint8Array(challenge.challenge_hash),
				scope: challenge.scope,
				row,
			};
		});
		if (!claimed.row) {
			throw new AppError(
				"CREDENTIAL_NOT_FOUND",
				400,
				"The Passkey could not confirm this action",
			);
		}
		return {
			challengeHash: claimed.challengeHash,
			user: mapUser(claimed.row),
			credential: mapCredential(claimed.row),
			scope: claimed.scope,
		};
	}

	async completeSecurityConfirmation(input: {
		credentialId: string;
		expectedCounter: number;
		newCounter: number;
		backedUp: boolean;
		confirmation: NewSecurityConfirmation;
		now: Date;
		requestId?: string;
	}): Promise<void> {
		await this.sql.begin(async (transaction) => {
			const [credential] = await transaction<{ user_id: string }[]>`
        UPDATE auth_credentials
        SET counter = ${input.newCounter},
            backed_up = ${input.backedUp},
            last_used_at = ${input.now}
        WHERE credential_id = ${input.credentialId}
          AND user_id = ${input.confirmation.userId}
          AND counter = ${input.expectedCounter}
          AND revoked_at IS NULL
        RETURNING user_id
      `;
			if (!credential) {
				throw new AppError(
					"CREDENTIAL_NOT_FOUND",
					400,
					"The Passkey could not confirm this action",
				);
			}
			await transaction`
        INSERT INTO security_confirmations (
          id, token_hash, user_id, scope, expires_at
        ) VALUES (
          ${input.confirmation.id},
          ${Buffer.from(input.confirmation.tokenHash)},
          ${input.confirmation.userId},
          ${input.confirmation.scope},
          ${input.confirmation.expiresAt}
        )
      `;
			await transaction`
        INSERT INTO audit_events (id, subject_user_id, event_type, result, request_id)
        VALUES (
          ${randomUUID()},
          ${input.confirmation.userId},
          ${`security.confirmed.${input.confirmation.scope}`},
          'success',
          ${input.requestId ?? null}
        )
      `;
		});
	}

	async prepareCredentialAddition(input: {
		userId: string;
		confirmationHash: Uint8Array;
		now: Date;
	}): Promise<{ user: UserRecord; credentials: CredentialRecord[] }> {
		return this.sql.begin(async (transaction) => {
			await this.consumeConfirmation(transaction, {
				userId: input.userId,
				tokenHash: input.confirmationHash,
				scope: "credential_add",
				now: input.now,
			});
			const [user] = await transaction<UserRow[]>`
        SELECT id, webauthn_user_id, display_name, status, created_at
        FROM users
        WHERE id = ${input.userId} AND status = 'active'
        FOR UPDATE
      `;
			if (!user) {
				throw new AppError(
					"SESSION_REQUIRED",
					401,
					"An active account is required",
				);
			}
			const rows = await transaction<CredentialRow[]>`
        SELECT credential_id, user_id, public_key, counter, transports,
               device_type, backed_up, label,
               created_at AS credential_created_at,
               last_used_at AS credential_last_used_at
        FROM auth_credentials
        WHERE user_id = ${input.userId} AND revoked_at IS NULL
        ORDER BY created_at
      `;
			return { user: mapUser(user), credentials: rows.map(mapCredential) };
		});
	}

	async claimCredentialAdditionChallenge(input: {
		flowTokenHash: Uint8Array;
		userId: string;
		now: Date;
	}): Promise<ClaimedChallenge> {
		return this.sql.begin(async (transaction) => {
			const [challenge] = await transaction<{ challenge_hash: Uint8Array }[]>`
        UPDATE auth_challenges
        SET consumed_at = ${input.now}
        WHERE flow_token_hash = ${Buffer.from(input.flowTokenHash)}
          AND kind = 'credential_addition'
          AND user_id = ${input.userId}
          AND consumed_at IS NULL
          AND expires_at > ${input.now}
        RETURNING challenge_hash
      `;
			if (!challenge) {
				throw new AppError(
					"CHALLENGE_INVALID",
					400,
					"The Passkey addition challenge is invalid or expired",
				);
			}
			const [user] = await transaction<UserRow[]>`
        SELECT id, webauthn_user_id, display_name, status, created_at
        FROM users
        WHERE id = ${input.userId} AND status = 'active'
        FOR UPDATE
      `;
			if (!user) {
				throw new AppError(
					"SESSION_REQUIRED",
					401,
					"An active account is required",
				);
			}
			return {
				challengeHash: new Uint8Array(challenge.challenge_hash),
				user: mapUser(user),
			};
		});
	}

	async completeCredentialAddition(input: {
		credential: CredentialRecord;
		now: Date;
		requestId?: string;
	}): Promise<void> {
		await this.sql.begin(async (transaction) => {
			const [credential] = await transaction<{ user_id: string }[]>`
        INSERT INTO auth_credentials (
          credential_id, user_id, label, public_key, counter, transports,
          device_type, backed_up
        )
        SELECT
          ${input.credential.id},
          ${input.credential.userId},
          ${input.credential.label},
          ${Buffer.from(input.credential.publicKey)},
          ${input.credential.counter},
          ${input.credential.transports},
          ${input.credential.deviceType},
          ${input.credential.backedUp}
        FROM users
        WHERE id = ${input.credential.userId} AND status = 'active'
        ON CONFLICT (credential_id) DO NOTHING
        RETURNING user_id
      `;
			if (!credential) {
				throw new AppError(
					"CREDENTIAL_EXISTS",
					409,
					"This Passkey is already registered",
				);
			}
			await transaction`
        INSERT INTO audit_events (id, subject_user_id, event_type, result, request_id)
        VALUES (${randomUUID()}, ${credential.user_id}, 'passkey.added', 'success', ${input.requestId ?? null})
      `;
		});
	}

	async listCredentials(userId: string): Promise<CredentialRecord[]> {
		const rows = await this.sql<CredentialRow[]>`
      SELECT credential_id, user_id, public_key, counter, transports,
             device_type, backed_up, label,
             created_at AS credential_created_at,
             last_used_at AS credential_last_used_at
      FROM auth_credentials
      WHERE user_id = ${userId} AND revoked_at IS NULL
      ORDER BY created_at
    `;
		return rows.map(mapCredential);
	}

	async completeRegistration(input: {
		registrationIntentHash: Uint8Array;
		credential: CredentialRecord;
		session: NewSession;
		now: Date;
		requestId?: string;
	}): Promise<ActiveSession> {
		return this.sql.begin(async (transaction) => {
			const [intent] = await transaction<{ user_id: string }[]>`
        UPDATE registration_intents
        SET consumed_at = ${input.now}
        WHERE token_hash = ${Buffer.from(input.registrationIntentHash)}
          AND user_id = ${input.credential.userId}
          AND consumed_at IS NULL
          AND expires_at > ${input.now}
        RETURNING user_id
      `;
			if (!intent) {
				throw new AppError(
					"REGISTRATION_REQUIRED",
					401,
					"The registration authorization is invalid or expired",
				);
			}

			await transaction`
        INSERT INTO auth_credentials (
          credential_id, user_id, label, public_key, counter, transports,
          device_type, backed_up
        ) VALUES (
          ${input.credential.id},
          ${input.credential.userId},
          ${input.credential.label},
          ${Buffer.from(input.credential.publicKey)},
          ${input.credential.counter},
          ${input.credential.transports},
          ${input.credential.deviceType},
          ${input.credential.backedUp}
        )
      `;
			const [user] = await transaction<UserRow[]>`
        UPDATE users
        SET status = 'active', updated_at = ${input.now}
        WHERE id = ${input.credential.userId} AND status = 'pending'
        RETURNING id, webauthn_user_id, display_name, status, created_at
      `;
			if (!user)
				throw new AppError(
					"REGISTRATION_REQUIRED",
					409,
					"The account is not awaiting registration",
				);

			await this.insertSession(transaction, input.session);
			await transaction`
        INSERT INTO audit_events (id, subject_user_id, event_type, result, request_id)
        VALUES (${randomUUID()}, ${user.id}, 'passkey.registered', 'success', ${input.requestId ?? null})
      `;
			return this.sessionResult(input.session, mapUser(user));
		});
	}

	async completeAuthentication(input: {
		credentialId: string;
		expectedCounter: number;
		newCounter: number;
		backedUp: boolean;
		session: NewSession;
		now: Date;
		requestId?: string;
	}): Promise<ActiveSession> {
		return this.sql.begin(async (transaction) => {
			const [credential] = await transaction<{ user_id: string }[]>`
        UPDATE auth_credentials
        SET counter = ${input.newCounter}, backed_up = ${input.backedUp}, last_used_at = ${input.now}
		WHERE credential_id = ${input.credentialId}
		  AND counter = ${input.expectedCounter}
		  AND revoked_at IS NULL
        RETURNING user_id
      `;
			if (!credential) {
				throw new AppError(
					"CREDENTIAL_NOT_FOUND",
					400,
					"The passkey could not be verified",
				);
			}
			const [user] = await transaction<UserRow[]>`
        SELECT id, webauthn_user_id, display_name, status, created_at
        FROM users
        WHERE id = ${credential.user_id} AND status = 'active'
      `;
			if (!user)
				throw new AppError(
					"SESSION_REQUIRED",
					401,
					"The account is not active",
				);

			await this.insertSession(transaction, input.session);
			await transaction`
        INSERT INTO audit_events (id, subject_user_id, event_type, result, request_id)
        VALUES (${randomUUID()}, ${user.id}, 'passkey.authenticated', 'success', ${input.requestId ?? null})
      `;
			return this.sessionResult(input.session, mapUser(user));
		});
	}

	async findAndTouchSession(
		tokenHash: Uint8Array,
		now: Date,
		nextIdleExpiry: Date,
	): Promise<ActiveSession | null> {
		const [row] = await this.sql<SessionRow[]>`
      UPDATE auth_sessions AS s
      SET idle_expires_at = LEAST(s.absolute_expires_at, ${nextIdleExpiry}), last_seen_at = ${now}
      FROM users AS u
      WHERE s.user_id = u.id
        AND s.token_hash = ${Buffer.from(tokenHash)}
        AND s.revoked_at IS NULL
        AND s.idle_expires_at > ${now}
        AND s.absolute_expires_at > ${now}
        AND u.status = 'active'
      RETURNING
        s.id AS session_id,
        s.assurance,
        s.idle_expires_at,
        s.absolute_expires_at,
        u.id,
        u.webauthn_user_id,
        u.display_name,
        u.status,
        u.created_at
    `;
		if (!row) return null;
		return {
			id: row.session_id,
			user: mapUser(row),
			assurance: row.assurance,
			idleExpiresAt: row.idle_expires_at,
			absoluteExpiresAt: row.absolute_expires_at,
		};
	}

	async revokeSession(
		tokenHash: Uint8Array,
		now: Date,
		requestId?: string,
	): Promise<void> {
		await this.sql.begin(async (transaction) => {
			const [session] = await transaction<{ user_id: string }[]>`
        UPDATE auth_sessions
        SET revoked_at = ${now}
        WHERE token_hash = ${Buffer.from(tokenHash)} AND revoked_at IS NULL
        RETURNING user_id
      `;
			if (session) {
				await transaction`
          INSERT INTO audit_events (id, subject_user_id, event_type, result, request_id)
          VALUES (${randomUUID()}, ${session.user_id}, 'session.revoked', 'success', ${requestId ?? null})
        `;
			}
		});
	}

	async revokeAllSessions(
		userId: string,
		now: Date,
		requestId?: string,
	): Promise<void> {
		await this.sql.begin(async (transaction) => {
			await transaction`
        UPDATE auth_sessions
        SET revoked_at = ${now}
        WHERE user_id = ${userId} AND revoked_at IS NULL
      `;
			await transaction`
        INSERT INTO audit_events (id, subject_user_id, event_type, result, request_id)
        VALUES (${randomUUID()}, ${userId}, 'session.revoked_all', 'success', ${requestId ?? null})
      `;
		});
	}

	async revokeCredential(input: {
		userId: string;
		credentialId: string;
		confirmationHash: Uint8Array;
		now: Date;
		requestId?: string;
	}): Promise<void> {
		await this.sql.begin(async (transaction) => {
			await this.consumeConfirmation(transaction, {
				userId: input.userId,
				tokenHash: input.confirmationHash,
				scope: "credential_revoke",
				now: input.now,
			});
			const credentials = await transaction<{ credential_id: string }[]>`
        SELECT credential_id
        FROM auth_credentials
        WHERE user_id = ${input.userId} AND revoked_at IS NULL
        FOR UPDATE
      `;
			if (
				!credentials.some(
					(credential) => credential.credential_id === input.credentialId,
				)
			) {
				throw new AppError(
					"CREDENTIAL_NOT_FOUND",
					404,
					"The Passkey is not active on this account",
				);
			}
			if (credentials.length <= 1) {
				throw new AppError(
					"LAST_CREDENTIAL",
					409,
					"Add another Passkey before removing the last active Passkey",
				);
			}
			await transaction`
        UPDATE auth_credentials
        SET revoked_at = ${input.now}
        WHERE credential_id = ${input.credentialId}
          AND user_id = ${input.userId}
          AND revoked_at IS NULL
      `;
			await transaction`
        UPDATE auth_sessions
        SET revoked_at = ${input.now}
        WHERE user_id = ${input.userId} AND revoked_at IS NULL
      `;
			await transaction`
        INSERT INTO audit_events (id, subject_user_id, event_type, result, request_id)
        VALUES (${randomUUID()}, ${input.userId}, 'passkey.revoked', 'success', ${input.requestId ?? null})
      `;
		});
	}

	async deleteAccount(input: {
		userId: string;
		confirmationHash: Uint8Array;
		now: Date;
		requestId?: string;
	}): Promise<void> {
		await this.sql.begin(async (transaction) => {
			await this.consumeConfirmation(transaction, {
				userId: input.userId,
				tokenHash: input.confirmationHash,
				scope: "account_delete",
				now: input.now,
			});
			const [user] = await transaction<{ id: string }[]>`
        UPDATE users
        SET status = 'deleted',
            display_name = 'Deleted account',
            deleted_at = ${input.now},
            updated_at = ${input.now}
        WHERE id = ${input.userId} AND status = 'active'
        RETURNING id
      `;
			if (!user) {
				throw new AppError(
					"SESSION_REQUIRED",
					401,
					"An active account is required",
				);
			}
			await transaction`
        UPDATE auth_credentials
        SET revoked_at = COALESCE(revoked_at, ${input.now}),
            label = 'Deleted Passkey',
            public_key = '\\x'::bytea,
            transports = '{}'
        WHERE user_id = ${input.userId}
      `;
			await transaction`
        UPDATE auth_sessions
        SET revoked_at = COALESCE(revoked_at, ${input.now})
        WHERE user_id = ${input.userId}
      `;
			await transaction`
        UPDATE registration_intents
        SET consumed_at = COALESCE(consumed_at, ${input.now})
        WHERE user_id = ${input.userId}
      `;
			await transaction`
        UPDATE auth_challenges
        SET consumed_at = COALESCE(consumed_at, ${input.now})
        WHERE user_id = ${input.userId}
      `;
			await transaction`
        UPDATE security_confirmations
        SET consumed_at = COALESCE(consumed_at, ${input.now})
        WHERE user_id = ${input.userId}
      `;
			await transaction`
        UPDATE consent_records
        SET withdrawn_at = COALESCE(withdrawn_at, ${input.now})
        WHERE user_id = ${input.userId}
      `;
			await transaction`
        INSERT INTO audit_events (id, subject_user_id, event_type, result, request_id)
        VALUES (${randomUUID()}, ${input.userId}, 'account.deleted', 'success', ${input.requestId ?? null})
      `;
		});
	}

	async recordAudit(event: AuditEvent): Promise<void> {
		await this.sql`
      INSERT INTO audit_events (id, subject_user_id, event_type, result, reason, request_id)
      VALUES (
        ${randomUUID()},
        ${event.subjectUserId ?? null},
        ${event.eventType},
        ${event.result},
        ${event.reason ?? null},
        ${event.requestId ?? null}
      )
    `;
	}

	async close(): Promise<void> {
		await this.sql.end();
	}

	private async insertSession(
		transaction: postgres.TransactionSql,
		session: NewSession,
	): Promise<void> {
		await transaction`
      INSERT INTO auth_sessions (
        id, token_hash, user_id, assurance, idle_expires_at, absolute_expires_at
      ) VALUES (
        ${session.id},
        ${Buffer.from(session.tokenHash)},
        ${session.userId},
        'passkey',
        ${session.idleExpiresAt},
        ${session.absoluteExpiresAt}
      )
    `;
	}

	private async consumeConfirmation(
		transaction: postgres.TransactionSql,
		input: {
			userId: string;
			tokenHash: Uint8Array;
			scope: SecurityConfirmationScope;
			now: Date;
		},
	): Promise<void> {
		const [confirmation] = await transaction<{ id: string }[]>`
      UPDATE security_confirmations
      SET consumed_at = ${input.now}
      WHERE token_hash = ${Buffer.from(input.tokenHash)}
        AND user_id = ${input.userId}
        AND scope = ${input.scope}
        AND consumed_at IS NULL
        AND expires_at > ${input.now}
      RETURNING id
    `;
		if (!confirmation) {
			throw new AppError(
				"CONFIRMATION_REQUIRED",
				403,
				"Confirm this action with an active Passkey",
			);
		}
	}

	private sessionResult(session: NewSession, user: UserRecord): ActiveSession {
		return {
			id: session.id,
			user,
			assurance: "passkey",
			idleExpiresAt: session.idleExpiresAt,
			absoluteExpiresAt: session.absoluteExpiresAt,
		};
	}
}
