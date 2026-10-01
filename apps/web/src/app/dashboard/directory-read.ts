"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// @project-doc docs/domains/geo_operations.md#monitoring_workflow
// @project-doc docs/domains/geo_operations.md#competitor_workflow
// @project-doc docs/domains/geo_operations.md#answer_evidence_workflow
export function useDirectoryRead<T>(url: string | null) {
  const [snapshot, setSnapshot] = useState<{
    url: string;
    data?: T;
    error: string;
    failures: number;
    successVersion: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);
  const reload = useCallback(async () => {
    const run = ++runRef.current;
    controllerRef.current?.abort();
    if (!url) return false;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    const current = () =>
      mountedRef.current &&
      !controller.signal.aborted &&
      run === runRef.current;
    try {
      const response = await fetch(url, { signal: controller.signal });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "请求失败，请重试");
      if (!current()) return false;
      setSnapshot({
        url,
        data: body.data,
        error: "",
        failures: 0,
        successVersion: run,
      });
      return true;
    } catch (error) {
      if (!current()) return false;
      setSnapshot((previous) => ({
        url,
        data: previous?.url === url ? previous.data : undefined,
        error: error instanceof Error ? error.message : "请求失败，请重试",
        failures: (previous?.url === url ? previous.failures : 0) + 1,
        successVersion: previous?.url === url ? previous.successVersion : 0,
      }));
      return false;
    } finally {
      if (current()) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    void reload();
    return () => controllerRef.current?.abort();
  }, [reload]);
  const current = snapshot?.url === url ? snapshot : null;
  return {
    data: current?.data,
    error: current?.error ?? "",
    failures: current?.failures ?? 0,
    loading,
    successVersion: current?.successVersion ?? 0,
    reload,
  };
}
