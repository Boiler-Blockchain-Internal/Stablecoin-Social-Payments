# groups

Owner: groups. Create groups, add members, and create splits (one `splits` row plus one `requests` row per member, linked by `split_id`).
Write through API routes in `src/app/api/` (verify the Privy token, then use the service-role Supabase client).

## Pages

| Path | What |
| --- | --- |
| `/groups` | My groups, with a link to create one |
| `/groups/new` | Name the group and add members by username |
| `/groups/[id]` | Group name and members; add by username, remove, or leave |

## API

`POST /api/groups` with `{ name, members: string[] }` creates the group with the caller as `created_by`, then adds the caller and each username to `group_members`.
Errors: 400 for a bad name or member list (empty name, invalid or duplicate username, adding yourself), 404 for unknown usernames, 409 if the caller hasn't picked a username yet.

`POST /api/groups/[id]/members` with `{ username }` adds an existing user. Only members can add.
Errors: 400 for a bad group id or username, 403 if the caller isn't a member, 404 for an unknown group or user, 409 if they're already in the group.

`DELETE /api/groups/[id]/members/[userId]` removes a member. The creator can remove anyone else, any member can remove themselves (leave), and the creator can't be removed.
Errors: 400 for bad ids, 403 for anything else not allowed, 404 if the person isn't in the group.

Shared server helpers live in `server.ts`; `validation.ts` is safe to import from the browser.
