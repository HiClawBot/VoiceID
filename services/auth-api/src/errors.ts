import type { ErrorCode } from "@voiceid/contracts";

export class AppError extends Error {
	readonly code: ErrorCode;
	readonly statusCode: number;

	constructor(code: ErrorCode, statusCode: number, message: string) {
		super(message);
		this.name = "AppError";
		this.code = code;
		this.statusCode = statusCode;
	}
}

export function publicError(error: unknown): AppError {
	if (error instanceof AppError) return error;
	return new AppError(
		"INTERNAL_ERROR",
		500,
		"The request could not be completed",
	);
}
