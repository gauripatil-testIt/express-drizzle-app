# Auth migration for existing users

This change adds a nullable `password_hash` column to `users` and requires a password to log in
with `POST /auth/login`. Rows created before this change have `password_hash = NULL` and therefore
cannot log in until a password is set.

## Identify passwordless users

```sql
SELECT id, name, email FROM users WHERE password_hash IS NULL;
```

## Set a password

`POST /auth/set-password` is authenticated (`Authorization: Bearer <access-token>`). Because a
passwordless user cannot yet log in, an operator must issue a temporary access token for that user
out-of-band before they can set a password. Use the application's JWT secret and the same 15-minute
access-token TTL as the running app (for example, an internal script that calls the app's
`signAccessToken(userId)`).

Once the user has a temporary token, have them call:

```http
POST /auth/set-password
Authorization: Bearer <temporary-token>
Content-Type: application/json

{ "password": "a-password-of-at-least-10-characters" }
```

The endpoint bcrypt-hashes the password, stores it in `users.password_hash`, and returns the user
as `{ id, name, email }` (never the hash). After this the user can log in normally with
`POST /auth/login`.
