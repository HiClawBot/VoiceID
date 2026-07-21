import { expect, test } from "@playwright/test";

test("registers, restores, re-authenticates, rejects replay, and revokes sessions", async ({
	page,
	context,
	request,
}) => {
	const cdp = await context.newCDPSession(page);
	await cdp.send("WebAuthn.enable");
	await cdp.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});

	await page.goto("/");
	await expect(page.getByRole("status")).toContainText(
		"No active server session",
	);

	await page.getByLabel("Display name").fill("E2E Passkey User");
	await page.getByLabel("Invitation code").fill("VOICEID-E2E-INVITE");
	await page.getByRole("button", { name: "Redeem invitation" }).click();
	await expect(page.getByRole("status")).toContainText("Invitation accepted");

	await page.getByRole("button", { name: "Create Passkey" }).click();
	await expect(
		page.getByRole("heading", { name: "Session active" }),
	).toBeVisible();
	await expect(page.getByRole("status")).toContainText("Passkey registered");
	await expect(page.locator("#session-user")).toHaveText("E2E Passkey User");

	const sessionCookie = (await context.cookies()).find(
		(cookie) => cookie.name === "voiceid_session",
	);
	expect(sessionCookie).toMatchObject({ httpOnly: true, sameSite: "Strict" });
	expect(sessionCookie?.value.length).toBeGreaterThanOrEqual(43);

	await page.reload();
	await expect(page.getByRole("status")).toContainText(
		"session restored by the server",
	);
	await expect(
		page.getByRole("heading", { name: "Session active" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Log out this session" }).click();
	await expect(page.getByRole("status")).toContainText(
		"session has been revoked",
	);
	await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

	let capturedBody: unknown;
	let capturedFlowToken: string | undefined;
	await page.route("**/v1/webauthn/authentication/verify", async (route) => {
		capturedBody = route.request().postDataJSON();
		capturedFlowToken = (await context.cookies()).find(
			(cookie) => cookie.name === "voiceid_flow",
		)?.value;
		await route.continue();
	});
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("status")).toContainText("Passkey verified");
	await page.unroute("**/v1/webauthn/authentication/verify");
	expect(capturedBody).toBeDefined();
	expect(capturedFlowToken).toBeDefined();

	await context.addCookies([
		{
			name: "voiceid_flow",
			value: capturedFlowToken ?? "missing",
			domain: "localhost",
			path: "/",
			httpOnly: true,
			secure: false,
			sameSite: "Strict",
		},
	]);
	const replay = await page.evaluate(async (body) => {
		const response = await fetch("/v1/webauthn/authentication/verify", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		return { status: response.status, payload: await response.json() };
	}, capturedBody);
	expect(replay.status).toBe(400);
	expect(replay.payload).toMatchObject({
		error: { code: "CHALLENGE_INVALID" },
	});

	await page.getByRole("button", { name: "Revoke all sessions" }).click();
	await expect(page.getByRole("status")).toContainText("All active sessions");
	const state = await page.evaluate(async () =>
		(await fetch("/v1/session")).json(),
	);
	expect(state).toEqual({ authenticated: false });

	const crossOrigin = await request.post(
		"http://127.0.0.1:3401/v1/webauthn/authentication/options",
		{
			headers: { Origin: "https://attacker.example" },
		},
	);
	expect(crossOrigin.status()).toBe(403);
	expect(await crossOrigin.json()).toMatchObject({
		error: { code: "INVALID_ORIGIN" },
	});
});
