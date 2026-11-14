# Contributing

Thanks for helping. Comment on an issue (or open one) before you start, so nobody does the same work twice.

## Setup

You need [Bun](https://bun.sh) and Node.js 24.

```sh
bun install
cp .env.example .env   # set BASE_URL=http://localhost:3000, DATA_DIR=data, SECRET and ADMIN_PASSWORD
bun run dev            # http://localhost:3000
```

## Checks

CI runs these on every pull request, plus a Docker image build. Run them before you push:

```sh
bun run check
```

`bun run fix` fixes formatting and blank-line spacing.

## Where code lives

- `src/lib`: business rules (orders, payments, members, messages, tracking, database).
- `src/app`: pages, routes and UI.
- `tests`: Vitest suites.
- `deploy`: Dockerfile and Caddyfile.

## Rules CI enforces

- Money is always integer cents, and prices always come from the stored product on the server, never from the request.
- Errors that cross a boundary (server actions, routes, webhooks) are codes such as `ORDER_NOT_FOUND`, never prose.
- No `SELECT *`: name every column.
- Nothing unused: no dead imports, parameters, exports, files or dependencies.

## Pull requests

- One change per pull request.
- Include a test that fails without your change.
- In the description, say what changed, how you validated it, and the test count from `bun run test`.

## Security

Report vulnerabilities privately through [GitHub security advisories](https://github.com/ToledoSDL/librefunnel/security/advisories/new), never in a public issue.
