import { randomBytes, randomUUID } from "node:crypto";
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type AuthenticationResponseJSON,
	type PublicKeyCredentialCreationOptionsJSON,
	type PublicKeyCredentialRequestOptionsJSON,
	type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type {
	InvitationRedeemResponse,
	Session,
	SessionState,
} from "@voiceid/contracts";
import type { AppConfig } from "./config.js";
import { createOpaqueToken, hashValue, matchesHash } from "./crypto.js";
import { AppError } from "./errors.js";
import type { AuthRepository } from "./repository.js";
import type {
	ActiveSession,
	CredentialRecord,
	NewSession,
	UserRecord,
} from "./types.js";

export const COOKIE_NAMES = {
	flow: "voiceid_flow",
	registration: "voiceid_registration",
	session: "voiceid_session",
} as const;

interface CeremonyStart<T> {
	options: T;
	flowToken: string;
}

interface CeremonyComplete {
	verified: true;
	session: Session;
	sessionToken: string;
}

function cleanDisplayName(value: string): string {
	const cleaned = value.trim().replace(/\s+/gu, " ");
	if (cleaned.length < 1 || cleaned.length > 64) {
		throw new AppError(
			"INVALID_REQUEST",
			400,
			"Display name must contain 1 to 64 characters",
		);
	}
	return cleaned;
}

function publicUser(user: UserRecord) {
	return {
		id: user.id,
		displayName: user.displayName,
		status: user.status,
		createdAt: user.createdAt.toISOString(),
	} as const;
}

function publicSession(session: ActiveSession): Session {
	return {
		authenticated: true,
		user: publicUser(session.user),
		assurance: "passkey",
		idleExpiresAt: session.idleExpiresAt.toISOString(),
		absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
	};
}

export class AuthService {
	constructor(
		private readonly config: AppConfig,
		private readonly repository: AuthRepository,
		private readonly now: () => Date = () => new Date(),
	) {}

	async seedDevelopmentInvitation(): Promise<void> {
		if (!this.config.devInviteCode) return;
		await this.repository.seedInvitation({
			id: randomUUID(),
			codeHash: hashValue(
				"invitation",
				this.config.devInviteCode,
				this.config.tokenPepper,
			),
			label: "Local development invitation",
			expiresAt: new Date(this.now().getTime() + 24 * 60 * 60 * 1000),
		});
	}

	async redeemInvitation(
		code: string,
		displayName: string,
		requestId?: string,
	): Promise<InvitationRedeemResponse & { registrationToken: string }> {
		const now = this.now();
		const normalizedCode = code.trim();
		if (normalizedCode.length < 8 || normalizedCode.length > 128) {
			throw new AppError(
				"INVITATION_INVALID",
				400,
				"The invitation is invalid or expired",
			);
		}

		const registrationToken = createOpaqueToken();
		const user = await this.repository.redeemInvitation({
			invitationHash: hashValue(
				"invitation",
				normalizedCode,
				this.config.tokenPepper,
			),
			userId: randomUUID(),
			webauthnUserId: Uint8Array.from(randomBytes(32)),
			displayName: cleanDisplayName(displayName),
			registrationIntentId: randomUUID(),
			registrationIntentHash: hashValue(
				"registration",
				registrationToken,
				this.config.tokenPepper,
			),
			registrationExpiresAt: new Date(
				now.getTime() + this.config.registrationIntentTtlMs,
			),
			now,
			...(requestId ? { requestId } : {}),
		});

		return {
			registrationReady: true,
			user: publicUser(user),
			registrationToken,
		};
	}

	async registrationOptions(
		registrationToken: string,
	): Promise<CeremonyStart<PublicKeyCredentialCreationOptionsJSON>> {
		const now = this.now();
		const user = await this.repository.getRegistrationUser(
			hashValue("registration", registrationToken, this.config.tokenPepper),
			now,
		);
		const options = await generateRegistrationOptions({
			rpName: this.config.rpName,
			rpID: this.config.rpId,
			userID: user.webauthnUserId,
			userName: user.displayName,
			userDisplayName: user.displayName,
			attestationType: "none",
			authenticatorSelection: {
				residentKey: "required",
				userVerification: "required",
			},
			supportedAlgorithmIDs: [-7, -257],
		});
		const flowToken = createOpaqueToken();
		await this.repository.createChallenge({
			id: randomUUID(),
			kind: "registration",
			userId: user.id,
			flowTokenHash: hashValue("flow", flowToken, this.config.tokenPepper),
			challengeHash: hashValue(
				"challenge",
				options.challenge,
				this.config.tokenPepper,
			),
			expiresAt: new Date(now.getTime() + this.config.challengeTtlMs),
		});
		return { options, flowToken };
	}

	async verifyRegistration(input: {
		registrationToken: string;
		flowToken: string;
		response: unknown;
		requestId?: string;
	}): Promise<CeremonyComplete> {
		const now = this.now();
		const registrationIntentHash = hashValue(
			"registration",
			input.registrationToken,
			this.config.tokenPepper,
		);
		const claimed = await this.repository.claimRegistrationChallenge({
			flowTokenHash: hashValue(
				"flow",
				input.flowToken,
				this.config.tokenPepper,
			),
			registrationIntentHash,
			now,
		});

		let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
		try {
			verification = await verifyRegistrationResponse({
				response: input.response as RegistrationResponseJSON,
				expectedChallenge: (challenge) =>
					matchesHash(
						"challenge",
						challenge,
						claimed.challengeHash,
						this.config.tokenPepper,
					),
				expectedOrigin: this.config.expectedOrigin,
				expectedRPID: this.config.rpId,
				requireUserVerification: true,
			});
		} catch {
			throw new AppError(
				"PASSKEY_INVALID",
				400,
				"The passkey registration could not be verified",
			);
		}
		if (!verification.verified || !verification.registrationInfo) {
			throw new AppError(
				"PASSKEY_INVALID",
				400,
				"The passkey registration could not be verified",
			);
		}

		const { credential, credentialDeviceType, credentialBackedUp } =
			verification.registrationInfo;
		const newCredential: CredentialRecord = {
			id: credential.id,
			userId: claimed.user.id,
			publicKey: credential.publicKey,
			counter: credential.counter,
			transports: credential.transports ?? [],
			deviceType: credentialDeviceType,
			backedUp: credentialBackedUp,
		};
		const { session, rawToken } = this.newSession(claimed.user.id, now);
		const activeSession = await this.repository.completeRegistration({
			registrationIntentHash,
			credential: newCredential,
			session,
			now,
			...(input.requestId ? { requestId: input.requestId } : {}),
		});
		return {
			verified: true,
			session: publicSession(activeSession),
			sessionToken: rawToken,
		};
	}

	async authenticationOptions(): Promise<
		CeremonyStart<PublicKeyCredentialRequestOptionsJSON>
	> {
		const now = this.now();
		const options = await generateAuthenticationOptions({
			rpID: this.config.rpId,
			userVerification: "required",
		});
		const flowToken = createOpaqueToken();
		await this.repository.createChallenge({
			id: randomUUID(),
			kind: "authentication",
			flowTokenHash: hashValue("flow", flowToken, this.config.tokenPepper),
			challengeHash: hashValue(
				"challenge",
				options.challenge,
				this.config.tokenPepper,
			),
			expiresAt: new Date(now.getTime() + this.config.challengeTtlMs),
		});
		return { options, flowToken };
	}

	async verifyAuthentication(input: {
		flowToken: string;
		response: unknown;
		requestId?: string;
	}): Promise<CeremonyComplete> {
		const now = this.now();
		const response = input.response as AuthenticationResponseJSON;
		if (!response || typeof response.id !== "string") {
			throw new AppError(
				"PASSKEY_INVALID",
				400,
				"The passkey response is malformed",
			);
		}
		const claimed = await this.repository.claimAuthenticationChallenge({
			flowTokenHash: hashValue(
				"flow",
				input.flowToken,
				this.config.tokenPepper,
			),
			credentialId: response.id,
			now,
		});
		if (!claimed.credential) {
			throw new AppError(
				"CREDENTIAL_NOT_FOUND",
				400,
				"The passkey could not be verified",
			);
		}

		let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
		try {
			verification = await verifyAuthenticationResponse({
				response,
				expectedChallenge: (challenge) =>
					matchesHash(
						"challenge",
						challenge,
						claimed.challengeHash,
						this.config.tokenPepper,
					),
				expectedOrigin: this.config.expectedOrigin,
				expectedRPID: this.config.rpId,
				credential: {
					id: claimed.credential.id,
					publicKey: claimed.credential.publicKey,
					counter: claimed.credential.counter,
					transports: claimed.credential.transports,
				},
				requireUserVerification: true,
			});
		} catch {
			throw new AppError(
				"PASSKEY_INVALID",
				400,
				"The passkey authentication could not be verified",
			);
		}
		if (!verification.verified) {
			throw new AppError(
				"PASSKEY_INVALID",
				400,
				"The passkey authentication could not be verified",
			);
		}

		const { session, rawToken } = this.newSession(claimed.user.id, now);
		const activeSession = await this.repository.completeAuthentication({
			credentialId: claimed.credential.id,
			expectedCounter: claimed.credential.counter,
			newCounter: verification.authenticationInfo.newCounter,
			backedUp: verification.authenticationInfo.credentialBackedUp,
			session,
			now,
			...(input.requestId ? { requestId: input.requestId } : {}),
		});
		return {
			verified: true,
			session: publicSession(activeSession),
			sessionToken: rawToken,
		};
	}

	async sessionState(rawToken: string | undefined): Promise<SessionState> {
		if (!rawToken) return { authenticated: false };
		const now = this.now();
		const session = await this.repository.findAndTouchSession(
			hashValue("session", rawToken, this.config.tokenPepper),
			now,
			new Date(now.getTime() + this.config.sessionIdleTtlMs),
		);
		return session ? publicSession(session) : { authenticated: false };
	}

	async logout(
		rawToken: string | undefined,
		requestId?: string,
	): Promise<void> {
		if (!rawToken) return;
		await this.repository.revokeSession(
			hashValue("session", rawToken, this.config.tokenPepper),
			this.now(),
			requestId,
		);
	}

	async revokeAll(
		rawToken: string | undefined,
		requestId?: string,
	): Promise<void> {
		const session = await this.requireSession(rawToken);
		await this.repository.revokeAllSessions(
			session.user.id,
			this.now(),
			requestId,
		);
	}

	private async requireSession(
		rawToken: string | undefined,
	): Promise<ActiveSession> {
		if (!rawToken)
			throw new AppError(
				"SESSION_REQUIRED",
				401,
				"An authenticated session is required",
			);
		const now = this.now();
		const session = await this.repository.findAndTouchSession(
			hashValue("session", rawToken, this.config.tokenPepper),
			now,
			new Date(now.getTime() + this.config.sessionIdleTtlMs),
		);
		if (!session)
			throw new AppError(
				"SESSION_REQUIRED",
				401,
				"An authenticated session is required",
			);
		return session;
	}

	private newSession(
		userId: string,
		now: Date,
	): { rawToken: string; session: NewSession } {
		const rawToken = createOpaqueToken();
		const absoluteExpiresAt = new Date(
			now.getTime() + this.config.sessionAbsoluteTtlMs,
		);
		return {
			rawToken,
			session: {
				id: randomUUID(),
				tokenHash: hashValue("session", rawToken, this.config.tokenPepper),
				userId,
				idleExpiresAt: new Date(
					Math.min(
						now.getTime() + this.config.sessionIdleTtlMs,
						absoluteExpiresAt.getTime(),
					),
				),
				absoluteExpiresAt,
			},
		};
	}
}
