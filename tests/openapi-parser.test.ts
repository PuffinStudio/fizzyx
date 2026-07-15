import { expect, test } from "bun:test";
import { parseSpec } from "../src/use-cases/openapi-parser";

test("parseSpec preserves security contracts and validated admin auth configuration", async () => {
	const spec = await parseSpec({
		openapi: "3.0.0",
		info: { title: "Secure API", version: "1.0.0" },
		components: {
			securitySchemes: {
				bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
			},
		},
		security: [{ bearerAuth: [] }],
		"x-fizzyx-admin": {
			auth: {
				mode: "server-cookie",
				loginOperationId: "authLogin",
				accessTokenPath: "data.access_token",
			},
		},
		paths: {
			"/auth/login": {
				post: {
					operationId: "authLogin",
					security: [],
					responses: { "200": { description: "ok" } },
				},
			},
		},
	});

	expect(spec.securitySchemes).toEqual([
		expect.objectContaining({ name: "bearerAuth", type: "http", scheme: "bearer" }),
	]);
	expect(spec.security).toEqual([["bearerAuth"]]);
	expect(spec.endpoints[0]?.security).toEqual([]);
	expect(spec.admin?.auth).toMatchObject({
		mode: "server-cookie",
		loginOperationId: "authLogin",
		accessTokenPath: "data.access_token",
		routes: { login: "/login", afterLogin: "/" },
	});
});

test("parseSpec rejects a protected or unknown configured login operation", async () => {
	await expect(
		parseSpec({
			openapi: "3.0.0",
			info: { title: "Secure API", version: "1.0.0" },
			security: [{ bearerAuth: [] }],
			"x-fizzyx-admin": {
				auth: {
					mode: "server-cookie",
					loginOperationId: "authLogin",
					accessTokenPath: "access_token",
				},
			},
			paths: {
				"/auth/login": {
					post: {
						operationId: "authLogin",
						responses: { "200": { description: "ok" } },
					},
				},
			},
		}),
	).rejects.toThrow("inherits root security");
});

test("parseSpec rejects incomplete explicit admin auth instead of guessing", async () => {
	await expect(
		parseSpec({
			openapi: "3.0.0",
			info: { title: "Secure API", version: "1.0.0" },
			"x-fizzyx-admin": { auth: { mode: "server-cookie" } },
			paths: {},
		}),
	).rejects.toThrow("loginOperationId is required");
});

test("parseSpec generates PascalCase request/response types from underscored operationIds", async () => {
	const doc = {
		openapi: "3.0.0",
		info: { title: "Activity", version: "1.0.0" },
		paths: {
			"/activity/enroll/{id}": {
				post: {
					operationId: "activity_enroll",
					parameters: [
						{
							name: "id",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
					],
					requestBody: {
						content: {
							"application/json": {
								schema: {
									properties: {
										name: { type: "string" },
									},
									required: ["name"],
								},
							},
						},
					},
					responses: {
						"200": {
							description: "ok",
							content: {
								"application/json": {
									schema: {
										properties: {
											success: { type: "boolean" },
										},
										required: ["success"],
									},
								},
							},
						},
					},
				},
			},
		},
	};

	const spec = await parseSpec(doc as Record<string, unknown>);

	expect(spec.types).toHaveProperty("ActivityEnrollRequest");
	expect(spec.types).toHaveProperty("ActivityEnrollResponse");
	expect(spec.endpoints[0]?.bodyTypeRef).toBe("ActivityEnrollRequest");
	expect(spec.endpoints[0]?.responseTypeRef).toBe("ActivityEnrollResponse");
});

test("parseSpec normalizes component schema names and schema refs to PascalCase", async () => {
	const doc = {
		openapi: "3.0.0",
		info: { title: "Activity", version: "1.0.0" },
		components: {
			schemas: {
				activity_enrollRequest: {
					type: "object",
					properties: {
						data: { $ref: "#/components/schemas/user_profile" },
					},
					required: ["data"],
				},
				user_profile: {
					type: "object",
					properties: {
						id: { type: "string" },
					},
					required: ["id"],
				},
			},
		},
		paths: {
			"/activity/enroll/{id}": {
				post: {
					operationId: "activity_enroll",
					parameters: [
						{
							name: "id",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
					],
					requestBody: {
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/activity_enrollRequest",
								},
							},
						},
					},
					responses: {
						"200": {
							description: "ok",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/activity_enrollRequest",
									},
								},
							},
						},
					},
				},
			},
		},
	};

	const spec = await parseSpec(doc as Record<string, unknown>);
	const endpoint = spec.endpoints[0];

	expect(spec.types).toHaveProperty("ActivityEnrollRequest");
	expect(spec.types).toHaveProperty("UserProfile");
	expect(endpoint?.bodyTypeRef).toBe("ActivityEnrollRequest");
	expect(endpoint?.responseTypeRef).toBe("ActivityEnrollRequest");
	expect(spec.types.ActivityEnrollRequest).toHaveProperty("kind", "interface");

	const activityEnrollProps = (
		spec.types.ActivityEnrollRequest as {
			properties?: Array<{ name: string; tsType: string }>;
		}
	).properties;
	const dataProp = activityEnrollProps?.find((p) => p.name === "data");
	expect(dataProp).toBeDefined();
	expect(dataProp?.tsType).toBe("UserProfile");
});
