---
name: fizzyx-openapi-admin-auth
description: Discover, verify, and configure authentication for a FizzyX-generated OpenAPI admin. Use when an agent needs to identify login, logout, current-user, refresh, security schemes, credential fields, or token/cookie response paths; diagnose a generated admin that lacks login; or prepare x-fizzyx-admin auth configuration without guessing security behavior.
---

# FizzyX OpenAPI Admin Auth

Treat authentication as a server security boundary. Never store access or refresh tokens in
`localStorage`, expose refresh tokens to browser JavaScript, or infer authorization from route names
alone.

Read `$fizzyx-openapi-admin-development` first for generated-file ownership and regeneration rules.

## Discover

1. Read the source OpenAPI document and `.fizzyx.yaml` when present. The config file is optional;
   direct `fizzyx openapi admin` flags must continue to work.
2. Inspect `components.securitySchemes`, root and operation `security`, request/response schemas,
   HTTP methods, paths, tags, summaries, and operation IDs.
3. Build separate candidate lists for `login`, `logout`, `me`, and `refresh`. Record the evidence for
   each candidate, including request credential fields and response token/cookie fields.
4. Prefer explicit `x-fizzyx-admin.auth` configuration over all inference.

## Decide

Classify every role independently:

- `confirmed`: explicitly configured, or exactly one candidate has matching method, schema, security,
  and response evidence.
- `candidate`: naming evidence exists but the contract is incomplete or ambiguous.
- `missing`: no credible operation exists.

Do not promote a `candidate` to configuration without user confirmation. If login is not confirmed,
stop before generating an enabled auth flow and tell the user exactly which fields or operations must
be configured manually.

Default to `server-cookie`: send credentials to a framework server handler/function, call the upstream
API from the server, and store session material in `HttpOnly`, `Secure` (in production), `SameSite`
cookies. Use `upstream-cookie` only when the upstream response itself establishes an HttpOnly session.
Treat client-side bearer storage as an explicit unsupported-risk exception, not a fallback.

## Configure

Write confirmed API semantics into the version-controlled OpenAPI root extension:

```yaml
x-fizzyx-admin:
  auth:
    mode: server-cookie
    loginOperationId: authLogin
    logoutOperationId: authLogout
    meOperationId: usersMe
    refreshOperationId: authRefresh
    usernameField: email
    passwordField: password
    accessTokenPath: data.access_token
    refreshTokenPath: data.refresh_token
    expiresInPath: data.expires_in
    routes:
      login: /login
      afterLogin: /
```

Omit optional operations and response paths that do not exist. For an immutable or remote OpenAPI
document, ask the user to add an equivalent auth override to the project's optional `.fizzyx.yaml`
instead of editing generated files.

## Verify

Regenerate the admin, run its `bun run check` and `bun run build`, then verify:

- unauthenticated admin navigation redirects to the login page on the server;
- bad credentials return a generic error and do not create a cookie;
- session cookies are HttpOnly and never appear in browser storage;
- protected server routes/functions independently enforce authentication;
- logout clears the session; when refresh is configured, refresh failures clear it and require login;
- no secret or token was written to source, logs, `.env.example`, or generated diagnostics.
