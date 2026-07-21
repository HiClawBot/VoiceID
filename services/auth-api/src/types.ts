import type {
	AuthenticatorTransportFuture,
	CredentialDeviceType,
} from "@simplewebauthn/server";

export type ChallengeKind = "registration" | "authentication";

export interface UserRecord {
	id: string;
	webauthnUserId: Uint8Array<ArrayBuffer>;
	displayName: string;
	status: "pending" | "active";
	createdAt: Date;
}

export interface CredentialRecord {
	id: string;
	userId: string;
	publicKey: Uint8Array<ArrayBuffer>;
	counter: number;
	transports: AuthenticatorTransportFuture[];
	deviceType: CredentialDeviceType;
	backedUp: boolean;
}

export interface ClaimedChallenge {
	challengeHash: Uint8Array;
	user: UserRecord;
	credential?: CredentialRecord;
}

export interface NewSession {
	id: string;
	tokenHash: Uint8Array;
	userId: string;
	idleExpiresAt: Date;
	absoluteExpiresAt: Date;
}

export interface ActiveSession {
	id: string;
	user: UserRecord;
	assurance: "passkey";
	idleExpiresAt: Date;
	absoluteExpiresAt: Date;
}

export interface AuditEvent {
	subjectUserId?: string;
	eventType: string;
	result: "success" | "failure";
	reason?: string;
	requestId?: string;
}
