import type {
	AdminAuthCandidate,
	AdminAuthPlan,
	AdminAuthRole,
	AdminPlanDiagnostic,
} from "../domain/openapi-admin-models";
import type { ParsedEndpoint, ParsedSpec } from "../domain/openapi-models";

const roleTerms: Record<AdminAuthRole, string[]> = {
	login: ["login", "signin", "sign-in", "token", "session"],
	logout: ["logout", "signout", "sign-out", "revoke"],
	me: ["me", "current-user", "currentuser", "profile"],
	refresh: ["refresh", "renew"],
};

const normalizedText = (endpoint: ParsedEndpoint): string =>
	[
		endpoint.operationId,
		endpoint.path,
		endpoint.summary,
		endpoint.description,
		...(endpoint.tags ?? []),
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();

const candidateFor = (
	spec: ParsedSpec,
	endpoint: ParsedEndpoint,
	role: AdminAuthRole,
): AdminAuthCandidate | undefined => {
	const text = normalizedText(endpoint);
	const evidence: string[] = [];
	let score = 0;
	const matchedTerms = roleTerms[role].filter((term) => text.includes(term));
	if (matchedTerms.length === 0) return undefined;
	score += Math.min(4, matchedTerms.length * 2);
	evidence.push(`name/path matches ${matchedTerms.join(", ")}`);

	const expectedMethods: Record<AdminAuthRole, ParsedEndpoint["method"][]> = {
		login: ["post"],
		logout: ["post", "delete"],
		me: ["get"],
		refresh: ["post"],
	};
	if (expectedMethods[role].includes(endpoint.method)) {
		score += 2;
		evidence.push(`uses ${endpoint.method.toUpperCase()}`);
	}
	if (endpoint.security?.length === 0 && role === "login") {
		score += 2;
		evidence.push("is explicitly public");
	}
	if (endpoint.security?.length && role !== "login") {
		score += 1;
		evidence.push("declares authentication");
	}
	const body = endpoint.bodyTypeRef
		? spec.types[endpoint.bodyTypeRef.replace(/\[\]$/, "")]
		: undefined;
	const properties = body?.properties?.map((property) => property.name.toLowerCase()) ?? [];
	if (role === "login" && properties.some((name) => ["password", "passcode"].includes(name))) {
		score += 2;
		evidence.push("request contains a password/passcode field");
	}
	if (
		role === "login" &&
		properties.some((name) => ["email", "username", "phone", "account"].includes(name))
	) {
		score += 2;
		evidence.push("request contains an identity field");
	}
	return { operationId: endpoint.operationId, score, evidence };
};

const candidatesFor = (spec: ParsedSpec, role: AdminAuthRole): AdminAuthCandidate[] =>
	spec.endpoints
		.map((endpoint) => candidateFor(spec, endpoint, role))
		.filter((candidate): candidate is AdminAuthCandidate => !!candidate)
		.sort(
			(left, right) =>
				right.score - left.score || left.operationId.localeCompare(right.operationId),
		);

export const discoverAdminAuth = (
	spec: ParsedSpec,
): { auth: AdminAuthPlan; diagnostics: AdminPlanDiagnostic[] } => {
	const candidates = {
		login: candidatesFor(spec, "login"),
		logout: candidatesFor(spec, "logout"),
		me: candidatesFor(spec, "me"),
		refresh: candidatesFor(spec, "refresh"),
	};
	if (spec.admin?.auth) {
		const login = spec.endpoints.find(
			(endpoint) => endpoint.operationId === spec.admin!.auth!.loginOperationId,
		);
		if (!login) {
			throw new Error(
				`configured auth references unknown login operationId ${spec.admin.auth.loginOperationId}`,
			);
		}
		if (login.method !== "post") throw new Error("configured login operation must use POST");
		if (spec.security?.length && login.security === undefined) {
			throw new Error("configured login inherits root security; declare security: [] on login");
		}
		if (login.security?.length) throw new Error("configured login operation must be public");
		if (spec.admin.auth.mode === "server-cookie" && !spec.admin.auth.accessTokenPath) {
			throw new Error("server-cookie auth requires accessTokenPath");
		}
		const body = login.bodyTypeRef
			? (spec.types[login.bodyTypeRef.replace(/\[\]$/, "")]?.properties ?? [])
			: [];
		const propertyNames = new Set(body.map((property) => property.name));
		const usernameField =
			spec.admin.auth.usernameField ??
			["email", "username", "phone", "account"].find((name) => propertyNames.has(name));
		const passwordField =
			spec.admin.auth.passwordField ??
			["password", "passcode"].find((name) => propertyNames.has(name));
		if (!usernameField || !passwordField) {
			throw new Error(
				"configured auth cannot determine usernameField/passwordField from the login request schema",
			);
		}
		if (spec.admin.auth.mode !== "server-cookie") {
			return {
				auth: {
					status: "needs-configuration",
					config: { ...spec.admin.auth, usernameField, passwordField },
					loginPath: login.path,
					securitySchemes: spec.securitySchemes ?? [],
					candidates,
				},
				diagnostics: [
					{
						code: "auth-unsupported",
						operationId: spec.admin.auth.loginOperationId,
						message:
							"Authentication is disabled: upstream-cookie mode requires an application-specific cookie rewrite policy; use server-cookie or customize the generated server adapter",
					},
				],
			};
		}
		return {
			auth: {
				status: "configured",
				config: { ...spec.admin.auth, usernameField, passwordField },
				loginPath: login.path,
				securitySchemes: spec.securitySchemes ?? [],
				candidates,
			},
			diagnostics: [],
		};
	}
	const login = candidates.login[0];
	return {
		auth: {
			status: "needs-configuration",
			securitySchemes: spec.securitySchemes ?? [],
			candidates,
		},
		diagnostics: [
			login
				? {
						code: "auth-candidate",
						operationId: login.operationId,
						message: `Authentication is disabled: ${login.operationId} is only a login candidate (score ${login.score}); confirm it in x-fizzyx-admin.auth or the optional .fizzyx.yaml override`,
					}
				: {
						code: "auth-missing",
						message:
							"Authentication is disabled: no credible login operation was found; configure x-fizzyx-admin.auth or the optional .fizzyx.yaml override",
					},
		],
	};
};
