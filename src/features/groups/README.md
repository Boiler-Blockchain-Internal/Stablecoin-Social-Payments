# groups

Owner: groups. Create groups, add members, and create splits (one `splits` row plus one `requests` row per member, linked by `split_id`).
Write through API routes in `src/app/api/` (verify the Privy token, then use the service-role Supabase client).

## Pages

| Path | What |
| --- | --- |
| `/groups` | My groups, with a link to create one |
| `/groups/new` | Name the group and add members by username |
| `/groups/[id]` | Group name and members |

## API

`POST /api/groups` with `{ name, members: string[] }` creates the group with the caller as `created_by`, then adds the caller and each username to `group_members`.
Errors: 400 for a bad name or member list (empty name, invalid or duplicate username, adding yourself), 404 for unknown usernames, 409 if the caller hasn't picked a username yet.

Shared server helpers live in `server.ts`; `validation.ts` is safe to import from the browser.
