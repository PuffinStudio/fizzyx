# Local authenticated admin example

This local-only example tests login, server-side cookies, the generated BFF, route protection, and
pet CRUD without depending on an external API. Do not reuse its fixed demo credentials or token in
production.

## 1. Start the API

From the FizzyX repository:

```sh
bun examples/openapi-admin-auth/server.ts
```

The API listens only on `127.0.0.1:4010`. Demo credentials:

- Email: `admin@example.com`
- Password: `admin123`

## 2. Generate an admin

In another terminal, choose one framework:

```sh
bun run src/main.ts openapi admin \
  --input examples/openapi-admin-auth/openapi.yaml \
  --output /tmp/fizzyx-local-next-admin \
  --framework nextjs
```

```sh
bun run src/main.ts openapi admin \
  --input examples/openapi-admin-auth/openapi.yaml \
  --output /tmp/fizzyx-local-start-admin \
  --framework tanstack-start
```

The first generation runs the official scaffold, `shadcn add --all`, OXC formatting, and lint fixes,
so it can take a few minutes.

## 3. Run and test it

For the Next.js output:

```sh
cd /tmp/fizzyx-local-next-admin
bun run check
bun run build
API_BASE_URL=http://127.0.0.1:4010 bun run dev
```

For the TanStack Start output, use the same commands in `/tmp/fizzyx-local-start-admin`.

Open <http://localhost:3000/login>, sign in, and visit `/pets`. Also verify:

- a wrong password shows `Invalid credentials`;
- opening `/pets` in a private window redirects to `/login`;
- browser storage has no access token;
- the session cookie is HttpOnly and SameSite;
- list/create/detail/edit/delete requests reach the local API through `/api/admin`;
- Sign out clears the local session and returns to `/login`.

If port `3000` is occupied, use the framework's dev-script port option, for example
`bun run dev -- --port 3100`.
