-- Preserve existing values and RLS. Fail safely if existing names collide by case.
create unique index users_username_lower_key on public.users (lower(username));
