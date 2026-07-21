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
	Credential,
	CredentialsResponse,
	ErrorResponse,
	InvitationRedeemResponse,
	OkResponse,
	SecurityConfirmationScope,
	SecurityConfirmationVerifyResponse,
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
	credentialList: requireElement<HTMLUListElement>("credential-list"),
	recoveryStatus: requireElement<HTMLParagraphElement>("recovery-status"),
	addCredentialForm: requireElement<HTMLFormElement>("add-credential-form"),
	credentialLabel: requireElement<HTMLInputElement>("credential-label"),
	addCredentialButton: requireElement<HTMLButtonElement>(
		"add-credential-button",
	),
	deleteAccountForm: requireElement<HTMLFormElement>("delete-account-form"),
	deleteConfirmation: requireElement<HTMLInputElement>("delete-confirmation"),
	deleteAccountButton: requireElement<HTMLButtonElement>(
		"delete-account-button",
	),
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
	if (!state.authenticated) {
		elements.credentialList.replaceChildren();
		elements.recoveryStatus.textContent = "A second Passkey is required";
		elements.recoveryStatus.dataset.ready = "false";
		elements.deleteAccountForm.reset();
		return;
	}

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
		if (state.authenticated) await loadCredentials();
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

function credentialMeta(credential: Credential): string {
	const storage = credential.backedUp
		? "synced/backup eligible"
		: "device-bound";
	const lastUsed = credential.lastUsedAt
		? `last used ${new Date(credential.lastUsedAt).toLocaleString()}`
		: "not used for sign-in yet";
	return `${credential.deviceType} · ${storage} · ${lastUsed}`;
}

function renderCredentials(result: CredentialsResponse): void {
	elements.credentialList.replaceChildren(
		...result.credentials.map((credential) => {
			const item = document.createElement("li");
			const label = document.createElement("strong");
			label.textContent = credential.label;
			const meta = document.createElement("span");
			meta.textContent = credentialMeta(credential);
			const remove = document.createElement("button");
			remove.type = "button";
			remove.textContent = "Remove";
			remove.dataset.credentialId = credential.id;
			remove.setAttribute("aria-label", `Remove ${credential.label}`);
			if (result.credentials.length === 1) {
				remove.disabled = true;
				remove.title = "Add another Passkey before removing this one";
			}
			item.append(label, meta, remove);
			return item;
		}),
	);
	elements.recoveryStatus.textContent = result.recoveryReady
		? "Recovery ready"
		: "A second Passkey is required";
	elements.recoveryStatus.dataset.ready = String(result.recoveryReady);
}

async function loadCredentials(): Promise<void> {
	renderCredentials(await api<CredentialsResponse>("/v1/credentials"));
}

async function confirmSecurityAction(
	scope: SecurityConfirmationScope,
): Promise<void> {
	const { options } = await api<CeremonyOptionsResponse>(
		"/v1/security-confirmation/options",
		{ method: "POST", body: JSON.stringify({ scope }) },
	);
	const response = await startAuthentication({
		optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
	});
	const result = await api<SecurityConfirmationVerifyResponse>(
		"/v1/security-confirmation/verify",
		{ method: "POST", body: JSON.stringify({ response }) },
	);
	if (result.scope !== scope) {
		throw new Error("The Passkey confirmation did not match this action.");
	}
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
		await loadCredentials();
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
		await loadCredentials();
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

elements.addCredentialForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	setBusy(elements.addCredentialButton, true, "Confirming current Passkey…");
	try {
		setStatus(
			"Use an existing Passkey to authorize adding a recovery Passkey.",
		);
		await confirmSecurityAction("credential_add");
		setBusy(elements.addCredentialButton, true, "Creating new Passkey…");
		const { options } = await api<CeremonyOptionsResponse>(
			"/v1/webauthn/credentials/options",
			{ method: "POST" },
		);
		const response = await startRegistration({
			optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
		});
		const result = await api<CredentialsResponse>(
			"/v1/webauthn/credentials/verify",
			{
				method: "POST",
				body: JSON.stringify({
					label: elements.credentialLabel.value,
					response,
				}),
			},
		);
		renderCredentials(result);
		setStatus(
			"The second Passkey is active. This account now has a recovery path.",
			"success",
		);
	} catch (error) {
		setStatus(messageFrom(error), "error");
	} finally {
		setBusy(elements.addCredentialButton, false, "");
	}
});

elements.credentialList.addEventListener("click", async (event) => {
	const button = event.target;
	if (!(button instanceof HTMLButtonElement)) return;
	const credentialId = button.dataset.credentialId;
	if (!credentialId) return;
	setBusy(button, true, "Confirming…");
	try {
		setStatus("Confirm Passkey removal with an active Passkey.");
		await confirmSecurityAction("credential_revoke");
		await api<OkResponse>("/v1/credentials", {
			method: "DELETE",
			body: JSON.stringify({ credentialId }),
		});
		renderSession({ authenticated: false });
		setStatus(
			"The Passkey was removed and all sessions were revoked. Sign in again.",
			"success",
		);
	} catch (error) {
		setStatus(messageFrom(error), "error");
	} finally {
		setBusy(button, false, "");
	}
});

elements.deleteAccountForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	setBusy(elements.deleteAccountButton, true, "Confirming Passkey…");
	try {
		await confirmSecurityAction("account_delete");
		setBusy(elements.deleteAccountButton, true, "Deleting account…");
		await api<OkResponse>("/v1/account", {
			method: "DELETE",
			body: JSON.stringify({
				confirmation: elements.deleteConfirmation.value,
			}),
		});
		renderSession({ authenticated: false });
		setStatus(
			"The account was deleted. Its Passkeys and sessions can no longer authenticate.",
			"success",
		);
	} catch (error) {
		setStatus(messageFrom(error), "error");
	} finally {
		setBusy(elements.deleteAccountButton, false, "");
	}
});

if (!browserSupportsWebAuthn()) {
	elements.registerButton.disabled = true;
	elements.signInButton.disabled = true;
	setStatus("This browser does not support WebAuthn Passkeys.", "error");
} else {
	void restoreSession();
}
