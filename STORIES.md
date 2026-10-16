# Feature Backlog: express-drizzle-app

Current state: single-file Express 5 API, SQLite via Drizzle, one `users` table, basic CRUD, no validation, no tests.

Each story has: **Story** (user-voice), **Description** (context and scope), **Acceptance Criteria** (Given/When/Then).

---

# Level 1: Simple

## S1. Validate user input

**Story**
As an API consumer, I want clear errors for invalid input, so that I can fix my requests quickly.

**Description**
`POST /users` only checks that fields are truthy. `PUT /users/:id` passes `req.body` straight into `.set()`, which allows mass-assignment of any column and throws on an empty body. Introduce Zod schemas for create and update. Duplicate emails currently surface as a 500.

**Acceptance Criteria**
1. Given a POST with an empty `name` or a non-string `name`, when submitted, then the response is 400 with `{ error, details: { name: "..." } }`.
2. Given a POST with a malformed email, when submitted, then the response is 400 with a message on `email`.
3. Given a PUT with unknown fields (e.g. `id`), when submitted, then those fields are ignored and never written.
4. Given a PUT with an empty body, when submitted, then the response is 400 (not a DB error).
5. Given an email that already exists, when creating or updating, then the response is 409 `{ error: "Email already in use" }`.
6. Given valid input, when submitted, then behavior and status codes are unchanged (201 / 200).

## S2. Reject invalid IDs

**Story**
As an API consumer, I want a clear 400 for a non-numeric ID, so that I can tell a bad request from a missing record.

**Description**
`Number("abc")` is `NaN`, which silently queries nothing and returns 404. Add shared ID-parsing middleware used by all `/:id` routes.

**Acceptance Criteria**
1. Given `GET /users/abc`, then the response is 400 `{ error: "Invalid id" }`.
2. Given `/users/-1`, `/users/1.5` or `/users/0`, then the response is 400.
3. Given a valid but non-existent ID such as `9999`, then the response is still 404.
4. Given a valid existing ID, then behavior is unchanged.
5. The same parser is reused by GET, PUT and DELETE (no duplicated logic).

## S3. Timestamps on users

**Story**
As an admin, I want to see when a user was created and last changed, so that I can audit account activity.

**Description**
Add `createdAt` and `updatedAt` columns via a Drizzle migration. Existing rows are backfilled.

**Acceptance Criteria**
1. Given a new user, when created, then `createdAt` and `updatedAt` are set and equal.
2. Given an existing user, when updated via PUT, then `updatedAt` changes and `createdAt` does not.
3. Given existing rows before the migration, when it runs, then they receive a non-null timestamp.
4. Given a client sends `createdAt` or `updatedAt` in a body, then the values are ignored.
5. The migration is generated with `db:generate` and committed in `./drizzle`.

## S4. Health check endpoint

**Story**
As an operator, I want a health endpoint, so that monitors and deploy tooling can tell if the service is working.

**Description**
`GET /health` verifies both the process and the database connection.

**Acceptance Criteria**
1. Given the app and DB are healthy, when calling `GET /health`, then the response is 200 `{ status: "ok" }`.
2. Given the DB query fails, then the response is 503 `{ status: "unavailable" }`.
3. The endpoint needs no authentication, now or after auth is added.
4. The check runs `SELECT 1` and responds in under 100 ms normally.

---

# Level 2: Easy to Medium

## M1. Restructure and centralize error handling

**Story**
As a developer, I want a layered structure with one error handler, so that new features are easy to add and errors look the same everywhere.

**Description**
Split `src/index.ts` into `app.ts` (app factory, so tests can import it), `server.ts` (listen), `routes/`, `services/` and `middleware/`. Add a global error middleware and a 404 handler. Define an `AppError` class with status and code.

**Acceptance Criteria**
1. Given any thrown error in a route, then the response is `{ error, code }` with the right status and no stack trace in the body.
2. Given an unknown route, then the response is 404 `{ error: "Route not found", code: "NOT_FOUND" }`.
3. Given an unexpected exception, then the response is 500 with a generic message and the full error is logged.
4. Given a rejected promise in an async handler, then it reaches the error handler (no hung requests).
5. `app` can be imported without starting a listener.
6. All existing endpoints behave identically (verified by the S1/M4 tests).

## M2. Pagination, sorting and search

**Story**
As an API consumer, I want to page, sort and search users, so that I can handle large lists efficiently.

**Description**
`GET /users` currently returns every row. Add query params `page`, `limit`, `sort`, `order` and `q`.

**Acceptance Criteria**
1. Given `GET /users`, then the response is `{ data, total, page, limit }`, defaulting to page 1, limit 20.
2. Given `limit=500`, then it is capped at 100.
3. Given `page=0`, `limit=-5` or a non-numeric value, then the response is 400.
4. Given `sort=name&order=desc`, then the results are sorted accordingly. Only whitelisted sort fields are allowed (otherwise 400).
5. Given `q=gau`, then only users whose name or email contains it (case-insensitive) are returned, and `total` reflects the filtered count.
6. Given a page beyond the last, then `data` is `[]` with the correct `total`.
7. Sorting is stable (ties broken by `id`).

## M3. Soft delete and restore

**Story**
As an admin, I want deleted users to be recoverable, so that accidental deletion isn't permanent.

**Description**
Add a nullable `deletedAt` column. DELETE becomes an update. Reads exclude deleted users by default.

**Acceptance Criteria**
1. Given `DELETE /users/:id`, then `deletedAt` is set, the row remains, and the response is 204.
2. Given a soft-deleted user, then `GET /users/:id` returns 404 and the list excludes them.
3. Given `POST /users/:id/restore` on a deleted user, then `deletedAt` is cleared and the user is returned with 200.
4. Given restore on a user who is not deleted, then the response is 409.
5. Given a new user with the email of a soft-deleted user, then the response is 409 with a hint to restore.
6. Given `?includeDeleted=true`, then deleted users are included in lists.

## M4. Automated tests

**Story**
As a developer, I want an automated test suite, so that I can refactor and add features safely.

**Description**
Use Vitest and Supertest. Each test file uses an isolated in-memory SQLite DB with migrations applied. Requires M1 (importable app) and an injectable DB.

**Acceptance Criteria**
1. Given `npm test`, then the suite runs without touching `sqlite.db`.
2. Every endpoint has at least one success and one failure test.
3. Each test starts from a clean DB (no order dependence).
4. Given any test fails, then the process exits non-zero.
5. The suite runs in under 10 seconds locally.
6. A coverage report is available through `npm run test:coverage`.

---

# Level 3: Medium

## M5. Posts (one-to-many)

**Story**
As a user, I want to write and manage posts, so that I can publish content.

**Description**
Add a `posts` table (`id`, `userId` FK, `title`, `body`, `publishedAt` nullable, timestamps). Define Drizzle relations between users and posts.

**Acceptance Criteria**
1. Given `POST /users/:id/posts` with a valid title and body, then the response is 201 and the post is linked to that user.
2. Given a non-existent user, then the response is 404.
3. Given `GET /users/:id/posts`, then only that user's posts are returned (paginated as in M2).
4. Given `GET /users/:id?include=posts`, then the user is returned with a `posts` array using a single relational query.
5. Given `GET/PUT/DELETE /posts/:id`, then they work, with 404 for unknown IDs.
6. Given a user is deleted (hard delete), then their posts cascade-delete. With soft delete, posts are hidden.
7. Given a draft post (`publishedAt` null), then it is excluded from public listings.

## M6. Tags (many-to-many)

**Story**
As an author, I want to tag posts and filter by tag, so that readers can find related content.

**Description**
Add `tags` (unique name) and a `post_tags` join table with a composite primary key. Tag assignment is replace-all and transactional.

**Acceptance Criteria**
1. Given `PUT /posts/:id/tags` with `["express", "drizzle"]`, then the post has exactly those tags, and missing tags are created.
2. Given the same tag in different case or with whitespace, then it is normalized (no duplicates).
3. Given a failure mid-update, then the tag set is unchanged (transaction rollback).
4. Given `GET /posts?tag=express`, then only posts with that tag are returned.
5. Given `GET /tags`, then each tag is returned with its post count.
6. Given a post is deleted, then its `post_tags` rows are removed, and the tag remains.
7. A limit of 10 tags per post is enforced (400 beyond that).

## M7. Config, logging and graceful shutdown

**Story**
As an operator, I want validated configuration and structured logs, so that the service is predictable and debuggable in production.

**Description**
Validate env vars with Zod at startup (`PORT`, `DATABASE_URL`, `LOG_LEVEL`, `NODE_ENV`). Use pino with a per-request ID. Handle SIGTERM and SIGINT.

**Acceptance Criteria**
1. Given an invalid or missing required env var, then the app fails at startup with a message naming the variable.
2. Given any request, then one JSON log line is emitted with method, path, status, duration and `requestId`.
3. Given an `X-Request-Id` header, then it is reused. Otherwise one is generated and returned in the response header.
4. Given SIGTERM, then the server stops accepting connections, finishes in-flight requests (max 10 s) and closes the DB, then exits 0.
5. Passwords, tokens and auth headers never appear in logs.
6. The DB path comes from config, not a hardcoded `"sqlite.db"` (including in `drizzle.config.ts`).

---

# Level 4: Complex

## C1. Authentication

**Story**
As a user, I want to register and log in securely, so that my account and data are protected.

**Description**
Add `passwordHash` to users and a `refresh_tokens` table (hashed token, userId, expiresAt, revokedAt). Short-lived JWT access tokens and rotating refresh tokens.

**Acceptance Criteria**
1. Given `POST /auth/register` with valid data, then the user is created, the password is hashed (argon2 or bcrypt), and the response contains no hash.
2. Given a password under 10 characters, then the response is 400.
3. Given `POST /auth/login` with correct credentials, then the response is an access token (15 min) and a refresh token (7 days).
4. Given wrong credentials, then the response is 401 with the same message for unknown email and wrong password.
5. Given `POST /auth/refresh` with a valid token, then a new pair is issued and the old refresh token is revoked.
6. Given a revoked refresh token is reused, then all of that user's refresh tokens are revoked (theft detection) and the response is 401.
7. Given `POST /auth/logout`, then the refresh token is revoked.
8. Given more than 5 failed logins per minute per IP or email, then the response is 429.
9. No endpoint ever returns `passwordHash`.
10. Existing users without a password cannot log in until they set one (documented migration path).

## C2. Authorization and roles

**Story**
As an admin, I want role-based access control, so that users can only do what they are permitted to.

**Description**
Add a `role` column (`user` | `admin`, default `user`). Add `requireAuth`, `requireRole` and an ownership check. Depends on C1.

**Acceptance Criteria**
1. Given no or an invalid token, when calling a protected route, then the response is 401.
2. Given a `user` token, when editing another user, then the response is 403.
3. Given a `user` token, when editing their own profile, then it succeeds. A `user` cannot change their own `role` (403 or ignored, documented).
4. Given a `user` token, when listing all users or deleting any user, then the response is 403.
5. Given an `admin` token, then all user operations are allowed, including promoting and demoting roles.
6. Given a post, then only its author or an admin can update or delete it. Anyone can read published posts.
7. The last remaining admin cannot be demoted or deleted.
8. A permission-matrix test covers every route against each of anonymous, user, owner and admin.

## C3. Threaded comments and moderation

**Story**
As a reader, I want to comment and reply on posts, and as an admin I want to moderate them, so that discussions stay healthy.

**Description**
Add `comments` (`postId`, `userId`, `parentId` nullable, `body`, `status`: visible/hidden) and `comment_flags`. Admin queue with an audit trail of actions.

**Acceptance Criteria**
1. Given `POST /posts/:id/comments`, then a top-level comment is created for the authenticated user.
2. Given `parentId` set to a comment on the same post, then it is created as a reply. A parent on a different post returns 400.
3. Given reply depth over 3, then the response is 400.
4. Given `GET /posts/:id/comments`, then comments return as a nested tree ordered oldest-first, excluding hidden ones.
5. Given a user flags a comment, then one flag per user per comment is stored (duplicates return 409).
6. Given 3 or more flags, then the comment is auto-hidden and appears in `GET /admin/moderation`.
7. Given an admin hides or restores a comment, then the action, actor and reason are recorded.
8. Given a hidden comment, then its author still sees it marked as hidden.
9. Given a comment with replies is hidden, then its replies remain visible under a "[removed]" placeholder.

## C4. Audit log and activity feed

**Story**
As an admin, I want a record of who changed what and when, so that I can investigate issues and meet compliance needs.

**Description**
Add `audit_log` (`actorId`, `entity`, `entityId`, `action`, `before` JSON, `after` JSON, `createdAt`). Writes happen in the same transaction as the change they describe.

**Acceptance Criteria**
1. Given any create, update, delete or restore of users, posts or comments, then exactly one audit row is written.
2. Given the change transaction rolls back, then no audit row exists.
3. Given an update, then `before` and `after` contain only changed fields, and `passwordHash` and tokens are never stored.
4. Given `GET /admin/audit?entity=user&actor=3&from=...&to=...`, then results are filtered, paginated and newest-first.
5. Given a non-admin, then the audit endpoints return 403.
6. Given `GET /users/:id/activity`, then the user's own actions are returned (self or admin only).
7. Audit rows cannot be modified or deleted via the API.

---

# Level 5: Very Complex

## X1. Background jobs and notifications

**Story**
As a user, I want to be notified about replies and account events, so that I stay engaged without polling.

**Description**
A DB-backed `jobs` queue (type, payload, status, attempts, runAt, lastError) processed by a separate worker. A `notifications` table for in-app notifications with read state and live delivery over SSE.

**Acceptance Criteria**
1. Given a reply to my comment, then a job is enqueued in the same transaction as the comment.
2. Given the worker is running, then pending jobs are picked up and processed without double-processing (atomic claim, multiple workers safe).
3. Given a job fails, then it retries with exponential backoff, up to 5 attempts, then moves to `dead` with `lastError`.
4. Given a job runs twice (crash after side effect), then the result is the same (idempotent via a dedupe key).
5. Given a processed job, then a notification row exists for the recipient.
6. Given `GET /notifications?unread=true`, then only my unread notifications are returned.
7. Given `POST /notifications/:id/read`, then it is marked read. Another user's notification returns 404.
8. Given an open `GET /notifications/stream` connection, then new notifications are pushed within 2 seconds, with a heartbeat every 30 seconds.
9. Given a worker is killed mid-job, then the job becomes claimable again after a visibility timeout.
10. `GET /admin/jobs?status=dead` lists failures, with a manual retry endpoint.

## X2. Full-text search and caching

**Story**
As a reader, I want fast, relevant search across posts, so that I can find content easily.

**Description**
SQLite FTS5 virtual table over post title and body, kept in sync by triggers. Add an in-memory LRU cache and HTTP caching for hot reads.

**Acceptance Criteria**
1. Given `GET /search?q=drizzle orm`, then results are ranked by relevance with highlighted snippets.
2. Given a post is created, updated or deleted, then the index reflects it immediately (via triggers).
3. Given FTS operators or special characters in `q` (`"`, `*`, `NEAR`), then they are sanitized (no SQL or FTS errors, no 500).
4. Given drafts, then they never appear in results (unless the requester is the author).
5. Given a repeated `GET /posts/:id`, then it is served from cache, and the response includes an `ETag`.
6. Given `If-None-Match` matching the ETag, then the response is 304.
7. Given a write to a post, then its cache entries are invalidated.
8. The cache is bounded (max entries) and has a TTL.
9. A benchmark shows before and after latency for 10k posts, documented in the README.

## X3. Multi-tenancy

**Story**
As a company, I want an isolated workspace for my team, so that our data is private and our users manage their own members.

**Description**
Add `organizations` and `memberships` (userId, orgId, role). Every tenant-owned table gets `orgId`. Tenant scoping is enforced in a single data-access layer so a missing filter is impossible by construction.

**Acceptance Criteria**
1. Given a request with an org context (`X-Org-Id` header or subdomain), when the user is not a member, then the response is 403.
2. Given any query for posts, comments or tags, then results are limited to the active org, with no per-route filters to forget.
3. Given a record from org A is requested by ID within org B, then the response is 404 (not 403, to avoid leaking existence).
4. Given an org admin invites an email, then a single-use, expiring (72 h) token is created, and accepting it creates the membership.
5. Given a user belongs to multiple orgs, then they hold a different role in each.
6. Given a migration run on existing data, then all current users, posts and comments are moved to a "Default" org, with no data loss.
7. Given an org is deleted, then all of its data is removed in one transaction.
8. A cross-tenant leak test suite hits every endpoint as org B against org A's IDs and expects zero data.
9. Tag names are unique per org, not globally.

## X4. Production readiness

**Story**
As an operator, I want documented, containerized and observable deployments, so that I can ship and run the service confidently.

**Description**
OpenAPI docs generated from the Zod schemas, a Docker image, CI, metrics and a documented path to Postgres.

**Acceptance Criteria**
1. Given `GET /docs`, then Swagger UI shows every endpoint with request and response schemas generated from Zod (no hand-written duplicate).
2. Given CI changes an endpoint without updating the spec, then the spec is regenerated from code, so it cannot drift.
3. Given `docker build`, then a multi-stage image under 200 MB runs as a non-root user with a `HEALTHCHECK` using `/health`.
4. Given a pull request, then CI runs typecheck, tests and a migration check (fails if the schema changed with no migration).
5. Given `GET /metrics`, then Prometheus metrics expose request count, latency histogram by route, error rate and DB query timing.
6. Given the repository layer, then no route or service imports `drizzle-orm/better-sqlite3` directly, so the driver can be swapped.
7. Given a `DATABASE_URL` for Postgres, then the app runs against it with the same test suite passing (documented, with the dialect differences listed).
8. A load test (k6 or autocannon) is committed, with documented throughput and p95 latency.

---

## Suggested Order

1. Foundation: **S1 → S2 → M1 → M4**
2. Data model: **S3 → M2 → M3 → M5 → M6**
3. Platform: **M7 → C1 → C2**
4. Depth: **C3 → C4**
5. Scale: **X1 → X2 → X3 → X4**

## Dependencies

| Story | Needs |
|---|---|
| M4 | M1 |
| M5, M6 | S1, M2 |
| C2 | C1 |
| C3 | M5, C2 |
| C4 | C2 |
| X1 | C3 |
| X2 | M5, M6 |
| X3 | C2 (best done before C3/C4 to avoid a heavy data migration) |
| X4 | M4, M7 |
