import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
	AccountDeleteRequestSchema,
	CeremonyOptionsResponseSchema,
	CeremonyVerifyRequestSchema,
	CeremonyVerifyResponseSchema,
	CredentialRegistrationVerifyRequestSchema,
	CredentialRevokeRequestSchema,
	CredentialsResponseSchema,
	ErrorResponseSchema,
	HealthResponseSchema,
	InvitationRedeemRequestSchema,
	InvitationRedeemResponseSchema,
	OkResponseSchema,
	SecurityConfirmationOptionsRequestSchema,
	SecurityConfirmationVerifyResponseSchema,
	SessionStateSchema,
	type CredentialRegistrationVerifyRequest,
	type CredentialRevokeRequest,
	type CeremonyVerifyRequest,
	type InvitationRedeemRequest,
	type SecurityConfirmationOptionsRequest,
} from "@voiceid/contracts";
import Fastify, {
	LogController,
	type FastifyError,
	type FastifyReply,
	type FastifyRequest,
} from "fastify";
import { AuthService, COOKIE_NAMES } from "./auth-service.js";
import type { AppConfig } from "./config.js";
import { AppError, publicError } from "./errors.js";
import type { AuthRepository } from "./repository.js";

export interface BuildAppOptions {
	config: AppConfig;
	repository: AuthRepository;
	logger?: boolean;
}

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function cookieOptions(config: AppConfig, maxAgeSeconds: number) {
	return {
		httpOnly: true,
		secure: config.cookieSecure,
		sameSite: "strict" as const,
		path: "/",
		maxAge: maxAgeSeconds,
		priority: "high" as const,
	};
}

function clearAuthCookies(reply: FastifyReply, config: AppConfig): void {
	const options = cookieOptions(config, 0);
	reply.clearCookie(COOKIE_NAMES.flow, options);
	reply.clearCookie(COOKIE_NAMES.confirmation, options);
	reply.clearCookie(COOKIE_NAMES.registration, options);
	reply.clearCookie(COOKIE_NAMES.session, options);
}

export async function buildApp(options: BuildAppOptions) {
	const { config, repository } = options;
	const app = Fastify({
		logger: options.logger ?? false,
		...(config.trustProxy ? { trustProxy: config.trustProxy } : {}),
		genReqId: () => randomUUID(),
		logController: new LogController({ disableRequestLogging: true }),
	});
	const auth = new AuthService(config, repository);

	await app.register(cookie);
	await app.register(helmet, {
		contentSecurityPolicy: {
			useDefaults: false,
			directives: {
				defaultSrc: ["'none'"],
				baseUri: ["'none'"],
				formAction: ["'none'"],
				frameAncestors: ["'none'"],
			},
		},
		crossOriginResourcePolicy: { policy: "same-origin" },
		frameguard: { action: "deny" },
		referrerPolicy: { policy: "no-referrer" },
	});
	await app.register(rateLimit, {
		global: true,
		max: 100,
		timeWindow: "1 minute",
		errorResponseBuilder: () => ({
			error: {
				code: "INVALID_REQUEST",
				message: "Too many requests",
				requestId: "rate-limited",
			},
		}),
	});
	await app.register(swagger, {
		convertConstToEnum: false,
		openapi: {
			openapi: "3.1.0",
			info: {
				title: "VoiceID Auth API",
				description:
					"Invite-only Passkey authentication and server-owned session lifecycle. Voice and wallet operations are not part of this API.",
				version: "0.1.0",
			},
			servers: [{ url: config.expectedOrigin }],
			components: {
				securitySchemes: {
					sessionCookie: {
						type: "apiKey",
						in: "cookie",
						name: COOKIE_NAMES.session,
					},
				},
			},
		},
	});

	app.addHook("onReady", async () => {
		await auth.seedDevelopmentInvitation();
	});
	app.addHook("onRequest", async (request) => {
		if (
			mutationMethods.has(request.method) &&
			request.url.startsWith("/v1/") &&
			request.headers.origin !== config.expectedOrigin
		) {
			throw new AppError(
				"INVALID_ORIGIN",
				403,
				"The request origin is not allowed",
			);
		}
	});
	app.addHook("onSend", async (request, reply, payload) => {
		if (request.url.startsWith("/v1/"))
			reply.header("Cache-Control", "no-store");
		reply.header(
			"Permissions-Policy",
			"camera=(), geolocation=(), microphone=(), payment=(), usb=()",
		);
		return payload;
	});

	app.get("/healthz", {
		schema: { response: { 200: HealthResponseSchema } },
		handler: async () => ({
			status: "ok" as const,
			service: "voiceid-auth-api" as const,
		}),
	});
	app.get("/readyz", {
		schema: {
			response: { 200: HealthResponseSchema, 503: HealthResponseSchema },
		},
		handler: async (_request, reply) => {
			try {
				await repository.ping();
				return { status: "ok" as const, service: "voiceid-auth-api" as const };
			} catch {
				return reply.code(503).send({
					status: "not_ready" as const,
					service: "voiceid-auth-api" as const,
				});
			}
		},
	});
	app.get("/openapi.json", {
		handler: async () => app.swagger(),
	});

	app.post("/v1/invitations/redeem", {
		config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
		schema: {
			body: InvitationRedeemRequestSchema,
			response: {
				200: InvitationRedeemResponseSchema,
				400: ErrorResponseSchema,
				403: ErrorResponseSchema,
			},
		},
		handler: async (request, reply) => {
			const body = request.body as InvitationRedeemRequest;
			const result = await auth.redeemInvitation(
				body.code,
				body.displayName,
				request.id,
			);
			reply.setCookie(
				COOKIE_NAMES.registration,
				result.registrationToken,
				cookieOptions(config, config.registrationIntentTtlMs / 1000),
			);
			return { registrationReady: true as const, user: result.user };
		},
	});

	app.post("/v1/webauthn/registration/options", {
		config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
		schema: {
			response: {
				200: CeremonyOptionsResponseSchema,
				401: ErrorResponseSchema,
			},
		},
		handler: async (request, reply) => {
			const registrationToken = request.cookies[COOKIE_NAMES.registration];
			if (!registrationToken) {
				throw new AppError(
					"REGISTRATION_REQUIRED",
					401,
					"Redeem a valid invitation before registering a passkey",
				);
			}
			const result = await auth.registrationOptions(registrationToken);
			reply.setCookie(
				COOKIE_NAMES.flow,
				result.flowToken,
				cookieOptions(config, config.challengeTtlMs / 1000),
			);
			return { options: result.options };
		},
	});

	app.post("/v1/webauthn/registration/verify", {
		config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
		schema: {
			body: CeremonyVerifyRequestSchema,
			response: {
				200: CeremonyVerifyResponseSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
			},
		},
		handler: async (request, reply) => {
			const registrationToken = request.cookies[COOKIE_NAMES.registration];
			const flowToken = request.cookies[COOKIE_NAMES.flow];
			if (!registrationToken) {
				throw new AppError(
					"REGISTRATION_REQUIRED",
					401,
					"The registration authorization is missing",
				);
			}
			if (!flowToken)
				throw new AppError(
					"FLOW_REQUIRED",
					400,
					"The registration flow is missing",
				);
			const result = await auth.verifyRegistration({
				registrationToken,
				flowToken,
				response: (request.body as CeremonyVerifyRequest).response,
				requestId: request.id,
			});
			reply.setCookie(
				COOKIE_NAMES.session,
				result.sessionToken,
				cookieOptions(config, config.sessionAbsoluteTtlMs / 1000),
			);
			reply.clearCookie(COOKIE_NAMES.flow, cookieOptions(config, 0));
			reply.clearCookie(COOKIE_NAMES.registration, cookieOptions(config, 0));
			return { verified: true as const, session: result.session };
		},
	});

	app.post("/v1/webauthn/authentication/options", {
		config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
		schema: { response: { 200: CeremonyOptionsResponseSchema } },
		handler: async (_request, reply) => {
			const result = await auth.authenticationOptions();
			reply.setCookie(
				COOKIE_NAMES.flow,
				result.flowToken,
				cookieOptions(config, config.challengeTtlMs / 1000),
			);
			return { options: result.options };
		},
	});

	app.post("/v1/webauthn/authentication/verify", {
		config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
		schema: {
			body: CeremonyVerifyRequestSchema,
			response: { 200: CeremonyVerifyResponseSchema, 400: ErrorResponseSchema },
		},
		handler: async (request, reply) => {
			const flowToken = request.cookies[COOKIE_NAMES.flow];
			if (!flowToken)
				throw new AppError(
					"FLOW_REQUIRED",
					400,
					"The authentication flow is missing",
				);
			const result = await auth.verifyAuthentication({
				flowToken,
				response: (request.body as CeremonyVerifyRequest).response,
				requestId: request.id,
			});
			reply.setCookie(
				COOKIE_NAMES.session,
				result.sessionToken,
				cookieOptions(config, config.sessionAbsoluteTtlMs / 1000),
			);
			reply.clearCookie(COOKIE_NAMES.flow, cookieOptions(config, 0));
			return { verified: true as const, session: result.session };
		},
	});

	app.get("/v1/credentials", {
		schema: {
			response: {
				200: CredentialsResponseSchema,
				401: ErrorResponseSchema,
			},
		},
		handler: async (request) =>
			auth.credentials(request.cookies[COOKIE_NAMES.session]),
	});

	app.post("/v1/security-confirmation/options", {
		config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
		schema: {
			body: SecurityConfirmationOptionsRequestSchema,
			response: {
				200: CeremonyOptionsResponseSchema,
				401: ErrorResponseSchema,
				409: ErrorResponseSchema,
			},
		},
		handler: async (request, reply) => {
			const body = request.body as SecurityConfirmationOptionsRequest;
			const result = await auth.securityConfirmationOptions(
				request.cookies[COOKIE_NAMES.session],
				body.scope,
			);
			reply.clearCookie(COOKIE_NAMES.confirmation, cookieOptions(config, 0));
			reply.setCookie(
				COOKIE_NAMES.flow,
				result.flowToken,
				cookieOptions(config, config.challengeTtlMs / 1000),
			);
			return { options: result.options };
		},
	});

	app.post("/v1/security-confirmation/verify", {
		config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
		schema: {
			body: CeremonyVerifyRequestSchema,
			response: {
				200: SecurityConfirmationVerifyResponseSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
			},
		},
		handler: async (request, reply) => {
			const flowToken = request.cookies[COOKIE_NAMES.flow];
			if (!flowToken) {
				throw new AppError(
					"FLOW_REQUIRED",
					400,
					"The security confirmation flow is missing",
				);
			}
			const result = await auth.verifySecurityConfirmation({
				rawSessionToken: request.cookies[COOKIE_NAMES.session],
				flowToken,
				response: (request.body as CeremonyVerifyRequest).response,
				requestId: request.id,
			});
			reply.clearCookie(COOKIE_NAMES.flow, cookieOptions(config, 0));
			reply.setCookie(
				COOKIE_NAMES.confirmation,
				result.confirmationToken,
				cookieOptions(config, config.securityConfirmationTtlMs / 1000),
			);
			return { confirmed: true as const, scope: result.scope };
		},
	});

	app.post("/v1/webauthn/credentials/options", {
		config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
		schema: {
			response: {
				200: CeremonyOptionsResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
			},
		},
		handler: async (request, reply) => {
			const result = await auth.credentialAdditionOptions(
				request.cookies[COOKIE_NAMES.session],
				request.cookies[COOKIE_NAMES.confirmation],
			);
			reply.clearCookie(COOKIE_NAMES.confirmation, cookieOptions(config, 0));
			reply.setCookie(
				COOKIE_NAMES.flow,
				result.flowToken,
				cookieOptions(config, config.challengeTtlMs / 1000),
			);
			return { options: result.options };
		},
	});

	app.post("/v1/webauthn/credentials/verify", {
		config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
		schema: {
			body: CredentialRegistrationVerifyRequestSchema,
			response: {
				200: CredentialsResponseSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				409: ErrorResponseSchema,
			},
		},
		handler: async (request, reply) => {
			const flowToken = request.cookies[COOKIE_NAMES.flow];
			if (!flowToken) {
				throw new AppError(
					"FLOW_REQUIRED",
					400,
					"The Passkey addition flow is missing",
				);
			}
			const body = request.body as CredentialRegistrationVerifyRequest;
			const result = await auth.verifyCredentialAddition({
				rawSessionToken: request.cookies[COOKIE_NAMES.session],
				flowToken,
				label: body.label,
				response: body.response,
				requestId: request.id,
			});
			reply.clearCookie(COOKIE_NAMES.flow, cookieOptions(config, 0));
			return result;
		},
	});

	app.delete("/v1/credentials", {
		schema: {
			body: CredentialRevokeRequestSchema,
			response: {
				200: OkResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				409: ErrorResponseSchema,
			},
		},
		handler: async (request, reply) => {
			const body = request.body as CredentialRevokeRequest;
			await auth.revokeCredential({
				rawSessionToken: request.cookies[COOKIE_NAMES.session],
				rawConfirmationToken: request.cookies[COOKIE_NAMES.confirmation],
				credentialId: body.credentialId,
				requestId: request.id,
			});
			clearAuthCookies(reply, config);
			return { ok: true as const };
		},
	});

	app.delete("/v1/account", {
		schema: {
			body: AccountDeleteRequestSchema,
			response: {
				200: OkResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
			},
		},
		handler: async (request, reply) => {
			await auth.deleteAccount({
				rawSessionToken: request.cookies[COOKIE_NAMES.session],
				rawConfirmationToken: request.cookies[COOKIE_NAMES.confirmation],
				requestId: request.id,
			});
			clearAuthCookies(reply, config);
			return { ok: true as const };
		},
	});

	app.get("/v1/session", {
		schema: { response: { 200: SessionStateSchema } },
		handler: async (request, reply) => {
			const state = await auth.sessionState(
				request.cookies[COOKIE_NAMES.session],
			);
			if (!state.authenticated)
				reply.clearCookie(COOKIE_NAMES.session, cookieOptions(config, 0));
			return state;
		},
	});

	app.delete("/v1/session", {
		schema: { response: { 200: OkResponseSchema } },
		handler: async (request, reply) => {
			await auth.logout(request.cookies[COOKIE_NAMES.session], request.id);
			clearAuthCookies(reply, config);
			return { ok: true as const };
		},
	});

	app.post("/v1/session/revoke-all", {
		schema: { response: { 200: OkResponseSchema, 401: ErrorResponseSchema } },
		handler: async (request, reply) => {
			await auth.revokeAll(request.cookies[COOKIE_NAMES.session], request.id);
			clearAuthCookies(reply, config);
			return { ok: true as const };
		},
	});

	app.setErrorHandler(
		async (error: FastifyError, request: FastifyRequest, reply) => {
			let mapped: AppError;
			if (error.validation) {
				mapped = new AppError(
					"INVALID_REQUEST",
					400,
					"The request body is invalid",
				);
			} else if (error.statusCode === 429) {
				mapped = new AppError("INVALID_REQUEST", 429, "Too many requests");
			} else {
				mapped = publicError(error);
			}

			if (mapped.statusCode >= 500)
				request.log.error(
					{ err: error, requestId: request.id },
					"request failed",
				);
			try {
				await repository.recordAudit({
					eventType: request.routeOptions.url ?? request.url,
					result: "failure",
					reason: mapped.code,
					requestId: request.id,
				});
			} catch (auditError) {
				request.log.error(
					{ err: auditError, requestId: request.id },
					"audit write failed",
				);
			}
			return reply.code(mapped.statusCode).send({
				error: {
					code: mapped.code,
					message: mapped.message,
					requestId: request.id,
				},
			});
		},
	);

	app.addHook("onClose", async () => {
		await repository.close();
	});

	return app;
}
