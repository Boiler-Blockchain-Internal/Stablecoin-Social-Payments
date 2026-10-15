"use client";

type UserPickerProps = {
  value: string;
  onChange: (username: string) => void;
  placeholder?: string;
};

/**
 * Pick a recipient by username.
 *
 * TODO (auth owner): replace with a search-as-you-type picker over `users.username`
 * (read via getSupabaseBrowser()). Keep this props shape so send/requests/groups don't break.
 */
export function UserPicker({ value, onChange, placeholder = "username" }: UserPickerProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value.trim())}
      placeholder={placeholder}
      autoComplete="off"
      className="w-full rounded-lg border border-zinc-300 px-3 py-2"
    />
  );
}
