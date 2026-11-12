"use client";

import { useEffect, useId, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { normalizeUsername } from "@/lib/username";
import { searchUsers, type SelectedUser } from "@/features/auth/searchUsers";

export type { SelectedUser } from "@/features/auth/searchUsers";
export type UserPickerProps = {
  /** Legacy controlled text interface. Arbitrary text is not a selected identity. */
  value?: string;
  onChange?: (username: string) => void;
  selectedUser?: SelectedUser | null;
  onSelect?: (user: SelectedUser | null) => void;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
};

export function UserPicker(props: UserPickerProps) {
  const { user } = usePrivy();
  return <UserPickerField key={user?.id ?? "signed-out"} {...props} />;
}

function UserPickerField({ value, onChange, selectedUser, onSelect, placeholder = "Search by username", disabled = false, label = "Find a user" }: UserPickerProps) {
  const { ready, authenticated, user } = usePrivy();
  const ownPrivyId = user?.id;
  const id = useId();
  const [text, setText] = useState("");
  const [internalSelection, setInternalSelection] = useState<SelectedUser | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{ key: string; users: SelectedUser[]; error?: string } | null>(null);
  const selection = selectedUser === undefined
    ? internalSelection && (value === undefined || value === internalSelection.username) ? internalSelection : null
    : selectedUser;
  const input = value ?? selection?.username ?? text;
  const query = normalizeUsername(input);
  const signedIn = ready && authenticated && !!user;
  const allowed = signedIn && !disabled;
  const searchable = allowed && open && !selection && /^[a-z0-9_]{1,20}$/.test(query);
  const key = JSON.stringify([user?.id, query, retry]);
  const result = response?.key === key ? response : null;
  const users = searchable ? result?.users ?? [] : [];
  const loading = searchable && !result;

  useEffect(() => {
    if (!searchable || !ownPrivyId) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const users = await searchUsers(query, ownPrivyId, controller.signal);
        if (!controller.signal.aborted) setResponse({ key, users });
      } catch {
        if (!controller.signal.aborted) setResponse({ key, users: [], error: "Unable to search users. Please try again." });
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchable, ownPrivyId, query, key]);

  function select(next: SelectedUser | null) {
    setInternalSelection(next);
    setText(next?.username ?? "");
    onChange?.(next?.username ?? "");
    onSelect?.(next);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="space-y-2" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
    }}>
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <div className="flex gap-2">
        <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={allowed && open && users.length > 0}
          aria-controls={`${id}-results`} aria-describedby={`${id}-status`}
          aria-activedescendant={active >= 0 && users[active] ? `${id}-option-${active}` : undefined}
          autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={20}
          value={signedIn ? input : ""} placeholder={placeholder} disabled={!allowed}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            if (selection) { setInternalSelection(null); onSelect?.(null); }
            setText(event.target.value); onChange?.(event.target.value.trim());
            setOpen(true); setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setOpen(false); setActive(-1); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setOpen(true);
              setActive((index) => users.length ? index < 0 ? (event.key === "ArrowDown" ? 0 : users.length - 1) : (index + (event.key === "ArrowDown" ? 1 : users.length - 1)) % users.length : -1);
            }
            if (event.key === "Enter" && open && users[active]) { event.preventDefault(); event.stopPropagation(); select(users[active]); }
          }}
          className="min-h-11 min-w-0 w-full rounded-lg border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-zinc-900 disabled:opacity-50" />
        {signedIn && input && <button type="button" disabled={disabled} onClick={() => select(null)}
          onKeyDown={(event) => { if (event.key === "Enter") event.stopPropagation(); }}
          className="min-h-11 shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm">Clear</button>}
      </div>
      <p id={`${id}-status`} role="status" className="text-sm text-zinc-500">
        {!ready ? "Loading session…" : !authenticated ? "Log in to search users." : disabled ? "Search disabled." : selection ? `Selected @${selection.username}` : loading ? "Searching…" : searchable && result && !result.error ? users.length ? `${users.length} matching users` : "No users found." : input && !/^[a-z0-9_]{1,20}$/.test(query) ? "Search using letters, numbers, or underscores." : "Type a username to search."}
      </p>
      {searchable && result?.error && <div role="alert" className="text-sm text-red-600"><p>{result.error}</p><button type="button" onClick={() => setRetry((n) => n + 1)} className="underline">Retry search</button></div>}
      <ul id={`${id}-results`} role="listbox" aria-label="Matching users" className={users.length ? "max-h-64 overflow-auto rounded-lg border border-zinc-200 bg-white" : "hidden"}>
        {users.map((match, index) => <li key={match.id} id={`${id}-option-${index}`} role="option" aria-selected={index === active}
          onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => select(match)}
          className={`cursor-pointer break-all px-3 py-3 text-sm ${index === active ? "bg-zinc-100" : "hover:bg-zinc-50"}`}>@{match.username}</li>)}
      </ul>
    </div>
  );
}
