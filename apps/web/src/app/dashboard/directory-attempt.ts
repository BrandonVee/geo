"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

const attemptSchema = z.object({
  id: z.string().uuid(),
  operation: z.string().min(1).max(100),
  details: z.array(z.object({ label: z.string(), value: z.string() })),
  submittedAt: z.string().datetime(),
  form: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("category"),
        name: z.string(),
        description: z.string(),
      }),
      z.object({
        kind: z.literal("prompts"),
        titleId: z.string(),
        text: z.string(),
      }),
      z.object({
        kind: z.literal("competitor"),
        name: z.string(),
        alias: z.string(),
        resourceId: z.string().optional(),
      }),
    ])
    .optional(),
});
export type DirectoryAttempt = z.infer<typeof attemptSchema>;
const activeAttempts = new Set<string>();

// @project-doc docs/domains/geo_operations.md#monitoring_workflow
// @project-doc docs/domains/geo_operations.md#competitor_workflow
export function useDirectoryAttempt(storageKey: string) {
  const [pending, setPending] = useState<DirectoryAttempt | null>(null);
  const [ready, setReady] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [resolvedVersion, setResolvedVersion] = useState(0);
  const [storageError, setStorageError] = useState("");
  const mountedRef = useRef(false);
  const pendingRef = useRef<DirectoryAttempt | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = attemptSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) throw new Error("INVALID_ATTEMPT");
        pendingRef.current = parsed.data;
        setPending(parsed.data);
        setInFlight(activeAttempts.has(parsed.data.id));
      }
      setReady(true);
    } catch {
      setStorageError(
        "无法读取原操作，请保持页面打开并先核对腾讯目录，再继续操作。",
      );
      // An unreadable previous operation cannot safely be discarded by a new write.
    }
    const synchronize = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== storageKey) return;
      if (event.type === "geo-monitoring-attempt-cleared")
        setResolvedVersion((current) => current + 1);
      setInFlight(
        Boolean(
          pendingRef.current && activeAttempts.has(pendingRef.current.id),
        ),
      );
      try {
        if (!sessionStorage.getItem(storageKey)) {
          pendingRef.current = null;
          setPending(null);
          setReady(true);
        }
      } catch {
        /* Keep the original record when storage is unavailable. */
      }
    };
    window.addEventListener("geo-monitoring-attempt-cleared", synchronize);
    window.addEventListener("geo-monitoring-attempt-settled", synchronize);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("geo-monitoring-attempt-cleared", synchronize);
      window.removeEventListener("geo-monitoring-attempt-settled", synchronize);
    };
  }, [storageKey]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pendingRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function begin(attempt: DirectoryAttempt) {
    activeAttempts.add(attempt.id);
    setInFlight(true);
    pendingRef.current = attempt;
    setPending(attempt);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(attempt));
    } catch {
      setStorageError(
        "本次操作无法在浏览器暂存，请保持页面打开，确认结果后再离开。",
      );
    }
  }
  function settle(id: string) {
    activeAttempts.delete(id);
    if (mountedRef.current) setInFlight(false);
    window.dispatchEvent(
      new CustomEvent("geo-monitoring-attempt-settled", { detail: storageKey }),
    );
  }
  function finish(expectedId?: string) {
    if (
      !expectedId &&
      pendingRef.current &&
      activeAttempts.has(pendingRef.current.id)
    )
      return false;
    // Clear this scope's storage even if its component has since unmounted.
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (
        expectedId &&
        raw &&
        attemptSchema.parse(JSON.parse(raw)).id !== expectedId
      )
        return false;
      sessionStorage.removeItem(storageKey);
      pendingRef.current = null;
      if (mountedRef.current) {
        setStorageError("");
        setPending(null);
        setReady(true);
      }
      window.dispatchEvent(
        new CustomEvent("geo-monitoring-attempt-cleared", {
          detail: storageKey,
        }),
      );
      return true;
    } catch {
      if (mountedRef.current)
        setStorageError(
          "无法清除原操作记录，请保持页面打开，恢复浏览器存储后再继续。",
        );
      return false;
    }
  }
  return {
    pending,
    ready,
    inFlight,
    resolvedVersion,
    storageError,
    begin,
    finish,
    settle,
  };
}
