import type {
	AuthenticatorTransportFuture,
	CredentialDeviceType,
} from "@simplewebauthn/server";

export type ChallengeKind =
	| "registration"
	| "authentication"
	| "credential_addition"
	| "security_confirmation";

export type SecurityConfirmationScope =
	| "credential_add"
	| "credential_revoke"
	| "account_delete";

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
	label: string;
	publicKey: Uint8Array<ArrayBuffer>;
	counter: number;
	transports: AuthenticatorTransportFuture[];
	deviceType: CredentialDeviceType;
	backedUp: boolean;
	createdAt: Date;
	lastUsedAt?: Date;
}

export interface ClaimedChallenge {
	challengeHash: Uint8Array;
	user: UserRecord;
	credential?: CredentialRecord;
	scope?: SecurityConfirmationScope;
}

export interface NewSession {
	id: string;
	tokenHash: Uint8Array;
	userId: string;
	idleExpiresAt: Date;
	absoluteExpiresAt: Date;
}

export interface NewSecurityConfirmation {
	id: string;
	tokenHash: Uint8Array;
	userId: string;
	scope: SecurityConfirmationScope;
	expiresAt: Date;
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
