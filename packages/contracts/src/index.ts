import { Type, type Static } from "@sinclair/typebox";

const DateTimeSchema = Type.String({ format: "date-time" });

export const UserSchema = Type.Object(
	{
		id: Type.String({ format: "uuid" }),
		displayName: Type.String({ minLength: 1, maxLength: 64 }),
		status: Type.Union([Type.Literal("pending"), Type.Literal("active")]),
		createdAt: DateTimeSchema,
	},
	{ additionalProperties: false, $id: "User" },
);
export type User = Static<typeof UserSchema>;

export const SessionSchema = Type.Object(
	{
		authenticated: Type.Literal(true),
		user: UserSchema,
		assurance: Type.Literal("passkey"),
		idleExpiresAt: DateTimeSchema,
		absoluteExpiresAt: DateTimeSchema,
	},
	{ additionalProperties: false, $id: "Session" },
);
export type Session = Static<typeof SessionSchema>;

export const SessionStateSchema = Type.Union([
	SessionSchema,
	Type.Object(
		{ authenticated: Type.Literal(false) },
		{ additionalProperties: false },
	),
]);
export type SessionState = Static<typeof SessionStateSchema>;

export const InvitationRedeemRequestSchema = Type.Object(
	{
		code: Type.String({ minLength: 8, maxLength: 128 }),
		displayName: Type.String({ minLength: 1, maxLength: 64 }),
	},
	{ additionalProperties: false, $id: "InvitationRedeemRequest" },
);
export type InvitationRedeemRequest = Static<
	typeof InvitationRedeemRequestSchema
>;

export const InvitationRedeemResponseSchema = Type.Object(
	{
		registrationReady: Type.Literal(true),
		user: UserSchema,
	},
	{ additionalProperties: false, $id: "InvitationRedeemResponse" },
);
export type InvitationRedeemResponse = Static<
	typeof InvitationRedeemResponseSchema
>;

export const CeremonyOptionsResponseSchema = Type.Object(
	{
		options: Type.Record(Type.String(), Type.Unknown()),
	},
	{ additionalProperties: false, $id: "CeremonyOptionsResponse" },
);
export type CeremonyOptionsResponse = Static<
	typeof CeremonyOptionsResponseSchema
>;

export const CeremonyVerifyRequestSchema = Type.Object(
	{
		response: Type.Record(Type.String(), Type.Unknown()),
	},
	{ additionalProperties: false, $id: "CeremonyVerifyRequest" },
);
export type CeremonyVerifyRequest = Static<typeof CeremonyVerifyRequestSchema>;

export const CeremonyVerifyResponseSchema = Type.Object(
	{
		verified: Type.Literal(true),
		session: SessionSchema,
	},
	{ additionalProperties: false, $id: "CeremonyVerifyResponse" },
);
export type CeremonyVerifyResponse = Static<
	typeof CeremonyVerifyResponseSchema
>;

export const OkResponseSchema = Type.Object(
	{ ok: Type.Literal(true) },
	{ additionalProperties: false, $id: "OkResponse" },
);
export type OkResponse = Static<typeof OkResponseSchema>;

export const HealthResponseSchema = Type.Object(
	{
		status: Type.Union([Type.Literal("ok"), Type.Literal("not_ready")]),
		service: Type.Literal("voiceid-auth-api"),
	},
	{ additionalProperties: false, $id: "HealthResponse" },
);
export type HealthResponse = Static<typeof HealthResponseSchema>;

export const ErrorCodeSchema = Type.Union([
	Type.Literal("INVALID_REQUEST"),
	Type.Literal("INVALID_ORIGIN"),
	Type.Literal("INVITATION_INVALID"),
	Type.Literal("REGISTRATION_REQUIRED"),
	Type.Literal("FLOW_REQUIRED"),
	Type.Literal("CHALLENGE_INVALID"),
	Type.Literal("PASSKEY_INVALID"),
	Type.Literal("CREDENTIAL_NOT_FOUND"),
	Type.Literal("SESSION_REQUIRED"),
	Type.Literal("NOT_READY"),
	Type.Literal("INTERNAL_ERROR"),
]);
export type ErrorCode = Static<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = Type.Object(
	{
		error: Type.Object(
			{
				code: ErrorCodeSchema,
				message: Type.String(),
				requestId: Type.String(),
			},
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false, $id: "ErrorResponse" },
);
export type ErrorResponse = Static<typeof ErrorResponseSchema>;
