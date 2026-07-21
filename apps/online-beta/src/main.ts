import {
	browserSupportsWebAuthn,
	startAuthentication,
	startRegistration,
	type PublicKeyCredentialCreationOptionsJSON,
	type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type {
	CeremonyOptionsResponse,
	CeremonyVerifyResponse,
	ErrorResponse,
	InvitationRedeemResponse,
	OkResponse,
	SessionState,
} from "@voiceid/contracts";

const elements = {
	status: requireElement<HTMLDivElement>("status"),
	guestPanel: requireElement<HTMLElement>("guest-panel"),
	sessionPanel: requireElement<HTMLElement>("session-panel"),
	inviteForm: requireElement<HTMLFormElement>("invite-form"),
	redeemButton: requireElement<HTMLButtonElement>("redeem-button"),
	registrationStep: requireElement<HTMLDivElement>("registration-step"),
	registerButton: requireElement<HTMLButtonElement>("register-button"),
	signInButton: requireElement<HTMLButtonElement>("signin-button"),
	logoutButton: requireElement<HTMLButtonElement>("logout-button"),
	revokeButton: requireElement<HTMLButtonElement>("revoke-button"),
	sessionUser: requireElement<HTMLElement>("session-user"),
	sessionAssurance: requireElement<HTMLElement>("session-assurance"),
	sessionIdle: requireElement<HTMLElement>("session-idle"),
	sessionAbsolute: requireElement<HTMLElement>("session-absolute"),
};

function requireElement<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) throw new Error(`Missing #${id}`);
	return element as T;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	if (init.body) headers.set("Content-Type", "application/json");
	const response = await fetch(path, {
		...init,
		credentials: "include",
		headers,
	});
	const payload = (await response.json()) as T | ErrorResponse;
	if (!response.ok) {
		const error = (payload as ErrorResponse).error;
		throw new Error(error?.message ?? `Request failed (${response.status})`);
	}
	return payload as T;
}

function setBusy(
	button: HTMLButtonElement,
	busy: boolean,
	busyLabel: string,
): void {
	if (!button.dataset.label)
		button.dataset.label = button.textContent ?? "Continue";
	button.disabled = busy;
	button.textContent = busy ? busyLabel : button.dataset.label;
}

function setStatus(
	message: string,
	tone: "neutral" | "success" | "error" = "neutral",
): void {
	elements.status.textContent = message;
	elements.status.dataset.tone = tone;
}

function renderSession(state: SessionState): void {
	elements.guestPanel.hidden = state.authenticated;
	elements.sessionPanel.hidden = !state.authenticated;
	if (!state.authenticated) return;

	elements.sessionUser.textContent = state.user.displayName;
	elements.sessionAssurance.textContent = state.assurance;
	elements.sessionIdle.textContent = new Date(
		state.idleExpiresAt,
	).toLocaleString();
	elements.sessionAbsolute.textContent = new Date(
		state.absoluteExpiresAt,
	).toLocaleString();
}

async function restoreSession(): Promise<void> {
	try {
		const state = await api<SessionState>("/v1/session");
		renderSession(state);
		setStatus(
			state.authenticated
				? "Authenticated session restored by the server."
				: "No active server session.",
			state.authenticated ? "success" : "neutral",
		);
	} catch (error) {
		renderSession({ authenticated: false });
		setStatus(messageFrom(error), "error");
	}
}

function messageFrom(error: unknown): string {
	if (error instanceof DOMException && error.name === "NotAllowedError") {
		return "The Passkey prompt was cancelled or timed out. You can try again.";
	}
	return error instanceof Error
		? error.message
		: "The operation could not be completed.";
}

elements.inviteForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	setBusy(elements.redeemButton, true, "Redeeming…");
	try {
		const data = new FormData(elements.inviteForm);
		const result = await api<InvitationRedeemResponse>(
			"/v1/invitations/redeem",
			{
				method: "POST",
				body: JSON.stringify({
					displayName: String(data.get("displayName") ?? ""),
					code: String(data.get("inviteCode") ?? ""),
				}),
			},
		);
		elements.inviteForm.hidden = true;
		elements.registrationStep.hidden = false;
		setStatus(
			`Invitation accepted for ${result.user.displayName}. Create the Passkey to activate the account.`,
			"success",
		);
	} catch (error) {
		setStatus(messageFrom(error), "error");
	} finally {
		setBusy(elements.redeemButton, false, "");
	}
});

elements.registerButton.addEventListener("click", async () => {
	setBusy(elements.registerButton, true, "Waiting for authenticator…");
	try {
		const { options } = await api<CeremonyOptionsResponse>(
			"/v1/webauthn/registration/options",
			{ method: "POST" },
		);
		const response = await startRegistration({
			optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
		});
		const result = await api<CeremonyVerifyResponse>(
			"/v1/webauthn/registration/verify",
			{
				method: "POST",
				body: JSON.stringify({ response }),
			},
		);
		renderSession(result.session);
		setStatus(
			"Passkey registered. The server issued an authenticated session.",
			"success",
		);
	} catch (error) {
		setStatus(messageFrom(error), "error");
	} finally {
		setBusy(elements.registerButton, false, "");
	}
});

elements.signInButton.addEventListener("click", async () => {
	setBusy(elements.signInButton, true, "Waiting for authenticator…");
	try {
		const { options } = await api<CeremonyOptionsResponse>(
			"/v1/webauthn/authentication/options",
			{ method: "POST" },
		);
		const response = await startAuthentication({
			optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
		});
		const result = await api<CeremonyVerifyResponse>(
			"/v1/webauthn/authentication/verify",
			{
				method: "POST",
				body: JSON.stringify({ response }),
			},
		);
		renderSession(result.session);
		setStatus("Passkey verified. The server issued a new session.", "success");
	} catch (error) {
		setStatus(messageFrom(error), "error");
	} finally {
		setBusy(elements.signInButton, false, "");
	}
});

elements.logoutButton.addEventListener("click", async () => {
	setBusy(elements.logoutButton, true, "Logging out…");
	try {
		await api<OkResponse>("/v1/session", { method: "DELETE" });
		renderSession({ authenticated: false });
		setStatus("This session has been revoked.", "success");
	} catch (error) {
		setStatus(messageFrom(error), "error");
	} finally {
		setBusy(elements.logoutButton, false, "");
	}
});

elements.revokeButton.addEventListener("click", async () => {
	setBusy(elements.revokeButton, true, "Revoking…");
	try {
		await api<OkResponse>("/v1/session/revoke-all", { method: "POST" });
		renderSession({ authenticated: false });
		setStatus(
			"All active sessions for this account have been revoked.",
			"success",
		);
	} catch (error) {
		setStatus(messageFrom(error), "error");
	} finally {
		setBusy(elements.revokeButton, false, "");
	}
});

if (!browserSupportsWebAuthn()) {
	elements.registerButton.disabled = true;
	elements.signInButton.disabled = true;
	setStatus("This browser does not support WebAuthn Passkeys.", "error");
} else {
	void restoreSession();
}
