"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  createReportExportSchema,
  type CreateReportExportInput,
} from "@geo/contracts";

import type { ExportJob } from "./report-history";

export const reportTypes = ["answers", "domain_rank", "article_rank"] as const;
export type ReportType = (typeof reportTypes)[number];
type ReportScope = Pick<
  CreateReportExportInput,
  "organizationId" | "teamBindingId" | "brandId" | "reportType"
>;
const pendingSchema = z.object({
  key: z.string().uuid(),
  payload: createReportExportSchema,
  submittedAt: z.string().datetime().optional(),
});
export type PendingReport = z.infer<typeof pendingSchema>;
type Entry = {
  pending?: PendingReport;
  active: boolean;
  ready: boolean;
  storageError: string;
};
const entries = new Map<string, Entry>();
const changed = "geo-report-attempt-changed";
const completed = "geo-report-attempt-completed";
const unreadable =
  "无法读取原导出记录，请恢复浏览器存储后重新读取暂存，避免重复导出。";

// @project-doc docs/domains/geo_operations.md#report_exports
export class ReportAttempt {
  private entry: Entry;
  constructor(
    private readonly storageKey: string,
    private readonly scope: ReportScope,
  ) {
    let entry = entries.get(storageKey);
    if (!entry) {
      entry = { active: false, ready: false, storageError: "" };
      entries.set(storageKey, entry);
    }
    this.entry = entry;
    if (!entry.ready) this.reload();
  }
  get pending() {
    return this.entry.pending;
  }
  get inFlight() {
    return this.entry.active;
  }
  get ready() {
    return this.entry.ready;
  }
  get storageError() {
    return this.entry.storageError;
  }
  private matches(payload: CreateReportExportInput) {
    return Object.entries(this.scope).every(
      ([field, value]) => payload[field as keyof ReportScope] === value,
    );
  }
  private notify() {
    if (typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent(changed, { detail: this.storageKey }),
      );
  }
  reload() {
    if (this.entry.active || this.entry.pending) return;
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      if (raw) {
        const value = JSON.parse(raw);
        // Earlier versions stored the full request as its fingerprint.
        const candidate =
          value?.fingerprint && !value.payload
            ? { key: value.key, payload: JSON.parse(value.fingerprint) }
            : value;
        const parsed = pendingSchema.safeParse(candidate);
        if (!parsed.success || !this.matches(parsed.data.payload))
          throw new Error("INVALID_REPORT_ATTEMPT");
        this.entry.pending = parsed.data;
      }
      this.entry.ready = true;
      this.entry.storageError = "";
    } catch {
      this.entry.ready = false;
      this.entry.storageError = unreadable;
    }
    this.notify();
  }
  begin(
    payload: CreateReportExportInput,
    generate = () => crypto.randomUUID(),
  ) {
    if (!this.entry.ready) throw new Error(unreadable);
    if (this.entry.active) throw new Error("原导出仍在提交，请等待结果。");
    const parsed = createReportExportSchema.parse(payload);
    if (!this.matches(parsed))
      throw new Error("导出范围已变化，请返回原品牌确认。");
    if (!this.entry.pending) {
      const pending: PendingReport = {
        key: generate(),
        payload: parsed,
        submittedAt: new Date().toISOString(),
      };
      try {
        sessionStorage.setItem(this.storageKey, JSON.stringify(pending));
        this.entry.storageError = "";
      } catch {
        this.entry.storageError =
          "无法暂存本次导出，尚未发送请求；请恢复浏览器存储后再试。";
        this.notify();
        throw new Error(this.entry.storageError);
      }
      this.entry.pending = pending;
    }
    this.entry.active = true;
    this.notify();
    return this.entry.pending;
  }
  settle(key: string) {
    if (this.entry.pending?.key !== key) return;
    this.entry.active = false;
    this.notify();
  }
  complete(key: string, job?: ExportJob) {
    if (this.entry.pending?.key !== key) return;
    this.entry.pending = undefined;
    this.entry.active = false;
    try {
      sessionStorage.removeItem(this.storageKey);
      this.entry.storageError = "";
    } catch {
      this.entry.storageError =
        "导出已确认，但暂存清理失败；刷新后可继续按原键确认。";
    }
    this.notify();
    if (job && typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent(completed, {
          detail: { storageKey: this.storageKey, job },
        }),
      );
  }
}

export function useReportAttempts(
  userId: string,
  scope: Omit<ReportScope, "reportType">,
) {
  const [attempts, setAttempts] = useState(
    new Map<ReportType, ReportAttempt>(),
  );
  const [ready, setReady] = useState(false);
  const [, redraw] = useState(0);
  const [completedReport, setCompletedReport] = useState<ExportJob>();
  const { organizationId, teamBindingId, brandId } = scope;
  const prefix = `geo.report.${userId}.${organizationId}.${brandId}.`;
  useEffect(() => {
    if (!organizationId || !teamBindingId || !brandId) return;
    const storageKeys = new Set(reportTypes.map((type) => `${prefix}${type}`));
    const update = (event: Event) => {
      if (event.type === completed) {
        const detail = (
          event as CustomEvent<{ storageKey: string; job: ExportJob }>
        ).detail;
        if (storageKeys.has(detail.storageKey)) setCompletedReport(detail.job);
      } else if (storageKeys.has((event as CustomEvent<string>).detail))
        redraw((value) => value + 1);
    };
    const restored = new Map<ReportType, ReportAttempt>();
    for (const reportType of reportTypes)
      restored.set(
        reportType,
        new ReportAttempt(`${prefix}${reportType}`, {
          organizationId,
          teamBindingId,
          brandId,
          reportType,
        }),
      );
    setAttempts(restored);
    setReady(true);
    window.addEventListener(changed, update);
    window.addEventListener(completed, update);
    return () => {
      window.removeEventListener(changed, update);
      window.removeEventListener(completed, update);
    };
  }, [prefix, organizationId, teamBindingId, brandId]);
  return {
    ready,
    completedReport,
    get: (reportType: ReportType) => attempts.get(reportType),
    pending: reportTypes.flatMap((type) => {
      const attempt = attempts.get(type);
      return attempt?.pending
        ? [{ type, attempt, record: attempt.pending }]
        : [];
    }),
    errors: reportTypes.flatMap((type) => {
      const attempt = attempts.get(type);
      return attempt?.storageError
        ? [{ type, attempt, message: attempt.storageError }]
        : [];
    }),
  };
}
