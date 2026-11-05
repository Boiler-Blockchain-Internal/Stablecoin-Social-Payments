"use client";

import type { ActivityFilter, HistoryGroup, HistoryPerson } from "./types";

export function HistoryFilters({ filter, onFilter, person, onPerson, group, onGroup, people, groups }: {
  filter: ActivityFilter;
  onFilter: (value: ActivityFilter) => void;
  person: string;
  onPerson: (value: string) => void;
  group: string;
  onGroup: (value: string) => void;
  people: HistoryPerson[];
  groups: HistoryGroup[];
}) {
  return (
    <div className="space-y-3">
      <div aria-label="Activity type" className="flex gap-2 overflow-x-auto pb-1">
        {(["all", "sent", "received", "pending"] as ActivityFilter[]).map((option) => (
          <button key={option} type="button" aria-pressed={filter === option} onClick={() => onFilter(option)}
            className={`shrink-0 rounded-full px-3 py-2 text-xs capitalize ${filter === option ? "bg-blue-600 text-white" : "bg-zinc-200 text-zinc-700"}`}>
            {option}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs font-medium text-zinc-600">Person
          <select aria-label="Filter by person" value={person} onChange={(e) => onPerson(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900">
            <option value="">Everyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>@{p.username}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-zinc-600">Group
          <select aria-label="Filter by group" value={group} onChange={(e) => onGroup(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900">
            <option value="">All groups</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
