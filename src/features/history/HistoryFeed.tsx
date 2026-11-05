"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ActivityRow } from "./ActivityRow";
import { filterActivity } from "./filter";
import { HistoryFilters } from "./HistoryFilters";
import type { ActivityFilter, ActivityResponse } from "./types";

export function HistoryFeed({ userId }: { userId: string }) {
  const { getAccessToken } = usePrivy();
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from load errors so the reload after a check doesn't wipe it.
  const [checkError, setCheckError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [person, setPerson] = useState("");
  const [group, setGroup] = useState("");
  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Session expired. Please log in again.");
        const response = await fetch("/api/activity", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load history.");
        if (!cancelled) { setData(body); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getAccessToken, refresh, userId]);

  // Cancelled send intents never moved money; leave them out of the feed.
  const visible = useMemo(() => (data?.items ?? []).filter((item) => !(item.kind === "transaction" && item.status === "failed" && !item.txHash)), [data]);
  const items = useMemo(() => filterActivity(visible, userId, filter, person, group), [visible, userId, filter, person, group]);
  const pendingIds = useMemo(() => visible
    .filter((item) => item.kind === "transaction" && item.status === "pending" && item.txHash)
    .map((item) => item.id), [visible]);

  const checkPending = useCallback(async (quiet = false) => {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Session expired. Please log in again.");
      const results = await Promise.allSettled(pendingIds.map(async (id) => {
        const response = await fetch("/api/transactions/check-status", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ transactionId: id }),
        });
        if (!response.ok) throw new Error("Unable to check one or more transfers.");
      }));
      if (!quiet) setCheckError(results.some((r) => r.status === "rejected") ? "Some transfers couldn't be checked yet." : null);
    } catch (e) {
      if (!quiet) setCheckError(e instanceof Error ? e.message : "Unable to check pending transfers.");
    } finally {
      reload();
    }
  }, [getAccessToken, pendingIds, reload]);

  // Base confirms in seconds: keep checking pending transfers for about a minute without a click.
  const autoChecks = useRef(0);
  const pendingKey = pendingIds.join(",");
  useEffect(() => { autoChecks.current = 0; }, [pendingKey]);
  useEffect(() => {
    if (!pendingKey || autoChecks.current >= 20) return;
    const timer = setTimeout(() => { autoChecks.current += 1; void checkPending(true); }, 3000);
    return () => clearTimeout(timer);
  }, [pendingKey, refresh, checkPending]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Activity</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={reload}>Refresh</Button>
          <Button onClick={() => checkPending()} disabled={pendingIds.length === 0}>Check pending</Button>
        </div>
      </div>
      <HistoryFilters filter={filter} onFilter={setFilter} person={person} onPerson={setPerson} group={group} onGroup={setGroup} people={data?.people ?? []} groups={data?.groups ?? []} />
      {(error ?? checkError) && <p role="alert" className="text-sm text-red-700">{error ?? checkError}</p>}
      {loading && !data ? <p role="status" className="text-sm text-zinc-500">Loading activity…</p> :
        <Card className="p-4">
          {items.length ? items.map((item) => <ActivityRow key={`${item.kind}-${item.id}`} item={item} userId={userId} />) :
            <p className="py-8 text-center text-sm text-zinc-500">No matching activity yet.</p>}
        </Card>}
    </div>
  );
}
