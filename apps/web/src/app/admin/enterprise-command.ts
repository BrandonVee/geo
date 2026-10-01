"use client";

import type { AdminUpdateOrganizationInput } from "@geo/contracts";
import { useEffect, useRef, useState } from "react";

export type EnterpriseSettings = {
  id: string;
  name: string;
  status: string;
  serviceExpiresAt: string | null;
  pointsExpiresAt: string | null;
};
const sameDate = (first: string | null, second: string | null) =>
  first === null || second === null
    ? first === second
    : new Date(first).getTime() === new Date(second).getTime();

// @project-doc docs/domains/identity_and_access.md#enterprise_validity
export function useEnterpriseCommand(
  organizationId: string,
  onSaved: () => void | Promise<void>,
) {
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<EnterpriseSettings | null>(null);
  const pending = useRef<AdminUpdateOrganizationInput | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function finish() {
    if (!mounted.current) return;
    pending.current = null;
    setChecking(false);
    await onSaved();
  }
  async function read() {
    const response = await fetch(
      `/api/v1/admin/organizations/${organizationId}`,
      { cache: "no-store" },
    );
    const body = await response.json();
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(body.error?.message ?? "企业设置核对失败");
    const current = body.data?.organization as EnterpriseSettings | undefined;
    if (
      !current ||
      current.id !== organizationId ||
      !["active", "suspended"].includes(current.status)
    )
      throw new Error("未能读取企业最新设置");
    return current;
  }
  async function verify() {
    const command = pending.current;
    if (!command) return;
    const current = await read();
    if (!mounted.current) return;
    if (!current) {
      pending.current = null;
      setChecking(false);
      setError("企业不存在或已关闭，请关闭弹窗后刷新目录。");
      return;
    }
    const saved =
      (command.status === undefined || command.status === current.status) &&
      (command.serviceExpiresAt === undefined ||
        sameDate(command.serviceExpiresAt, current.serviceExpiresAt)) &&
      (command.pointsExpiresAt === undefined ||
        sameDate(command.pointsExpiresAt, current.pointsExpiresAt));
    if (saved) return finish();
    pending.current = null;
    setChecking(false);
    setLatest(current);
    setError("尚未确认这次变更已保存。请核对最新设置后再操作，原输入已保留。");
  }
  async function execute(input?: AdminUpdateOrganizationInput) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (checking) return await verify();
      if (!input || latest) return;
      pending.current = input;
      const response = await fetch(
        `/api/v1/admin/organizations/${organizationId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        if (response.status >= 500)
          throw new Error(body.error?.message ?? "保存失败");
        if (!mounted.current) return;
        pending.current = null;
        setError(body.error?.message ?? "企业设置未保存");
        if (body.error?.details?.current) setLatest(body.error.details.current);
        return;
      }
      await finish();
    } catch {
      if (!mounted.current) return;
      try {
        await verify();
      } catch {
        if (mounted.current) {
          setChecking(true);
          setError("提交结果尚未核实，请先核对结果，避免重复操作。");
        }
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    busy,
    checking,
    error,
    latest,
    execute,
    acceptLatest: () => {
      setLatest(null);
      setError("");
    },
  };
}
