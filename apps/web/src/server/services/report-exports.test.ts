import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReportExportSchema } from "@geo/contracts";
const m = vi.hoisted(() => ({
  authorize: vi.fn(),
  existing: vi.fn(),
  create: vi.fn(),
  prepare: vi.fn(),
  enqueue: vi.fn(),
  find: vi.fn(),
  list: vi.fn(),
  count: vi.fn(),
}));
vi.mock("@/server/permissions/brand-scope", () => ({
  authorizeBrand: m.authorize,
}));
vi.mock("@/server/jobs/boss", () => ({ prepareReportExportQueue: m.prepare }));
vi.mock("@/server/repositories/report-exports", () => ({
  reportExportRepository: {
    findByIdempotency: m.existing,
    create: m.create,
    find: m.find,
    list: m.list,
    count: m.count,
  },
}));
import { reportExportService } from "./report-exports";
const org = "11111111-1111-4111-8111-111111111111",
  team = "22222222-2222-4222-8222-222222222222";
const input = createReportExportSchema.parse({
  organizationId: org,
  teamBindingId: team,
  brandId: "brand",
  reportType: "answers",
  beginDate: "2026-09-01",
  endDate: "2026-09-23",
  keyword: "选购",
  mentionBrand: 0,
});
const {
  organizationId: _,
  teamBindingId: __,
  brandId: ___,
  reportType: ____,
  ...filters
} = input;
void [_, __, ___, ____];
const row = {
  id: "export",
  organizationId: org,
  teamBindingId: team,
  brandId: "brand",
  reportType: "answers",
  filters,
  requestedBy: "user",
  status: "queued",
  quotaReservationKey: "report:export:reserve",
  queueJobId: "queue",
  expiresAt: null,
  errorCode: null,
  fileContent: "private CSV",
};
const audit = {
  organizationId: org,
  actorUserId: "user",
  requestId: "request",
};
beforeEach(() => {
  vi.resetAllMocks();
  m.existing.mockResolvedValue(row);
  m.find.mockResolvedValue(row);
  m.create.mockResolvedValue({ ok: true, job: row, replayed: false });
  m.prepare.mockResolvedValue(m.enqueue);
  m.enqueue.mockResolvedValue("queue");
  m.list.mockResolvedValue([row]);
  m.count.mockResolvedValue(1);
});
describe("报告提交与重试", () => {
  it("相同请求重放不占用新额度、不重新入队或返回文件正文", async () => {
    const replay = await reportExportService.create(
      input,
      "key",
      "user",
      audit,
    );
    expect(replay).toMatchObject({ id: "export", replayed: true });
    expect(replay).not.toHaveProperty("fileContent");
    expect(m.create).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it.each([
    { brandId: "other" },
    { teamBindingId: org },
    { reportType: "domain_rank" },
    { keyword: "其他问题" },
    { mentionBrand: 1 },
  ])("同一键不能用于不同范围或条件 %j", async (change) => {
    m.existing.mockResolvedValue({
      ...row,
      ...change,
      filters: {
        ...filters,
        ...(change.keyword ? { keyword: change.keyword } : {}),
        ...(change.mentionBrand !== undefined
          ? { mentionBrand: change.mentionBrand }
          : {}),
      },
    });
    await expect(
      reportExportService.create(input, "key", "user", audit),
    ).rejects.toMatchObject({ code: "REPORT_EXPORT_IDEMPOTENCY_CONFLICT" });
  });
  it("其他操作者不能重放同一键", async () => {
    await expect(
      reportExportService.create(input, "key", "other", audit),
    ).rejects.toMatchObject({ code: "REPORT_EXPORT_IDEMPOTENCY_CONFLICT" });
  });
  it("并发提交由事务返回原任务，仍校验请求身份", async () => {
    m.existing.mockResolvedValue(undefined);
    m.create.mockImplementation(async (_input, _key, _user, options) => {
      options.validateReplay(row);
      return { ok: true, job: row, replayed: true };
    });
    await expect(
      reportExportService.create(input, "key", "user", audit),
    ).resolves.toMatchObject({ replayed: true });
    await expect(
      reportExportService.create(input, "key", "other", audit),
    ).rejects.toMatchObject({ code: "REPORT_EXPORT_IDEMPOTENCY_CONFLICT" });
  });
  it("额度不足不返回成功任务，之后允许用原键重试", async () => {
    m.existing.mockResolvedValue(undefined);
    m.create.mockResolvedValueOnce({ ok: false, code: "QUOTA_EXHAUSTED" });
    await expect(
      reportExportService.create(input, "key", "user", audit),
    ).rejects.toMatchObject({ status: 402, code: "QUOTA_EXHAUSTED" });
    await expect(
      reportExportService.create(input, "key", "user", audit),
    ).resolves.toMatchObject({ id: "export", replayed: false });
  });
  it("旧的半成品任务进入事务恢复，不直接当作重放成功", async () => {
    m.existing.mockResolvedValue({ ...row, queueJobId: null });
    await reportExportService.create(input, "key", "user", audit);
    expect(m.prepare).toHaveBeenCalledOnce();
    expect(m.create).toHaveBeenCalledWith(
      input,
      "key",
      "user",
      expect.objectContaining({
        enqueue: m.enqueue,
        audit: expect.objectContaining({ context: audit }),
      }),
    );
  });
  it("完成的原任务不依赖队列再次启动；失去权限不返回任务", async () => {
    m.existing.mockResolvedValue({
      ...row,
      status: "succeeded",
      queueJobId: null,
    });
    await expect(
      reportExportService.create(input, "key", "user", audit),
    ).resolves.toMatchObject({ replayed: true });
    expect(m.prepare).not.toHaveBeenCalled();
    m.authorize.mockRejectedValueOnce(new Error("forbidden"));
    await expect(
      reportExportService.create(input, "key", "user", audit),
    ).rejects.toThrow("forbidden");
  });
  it("文件即使尚未被周期任务清理，已超过期限也立即显示过期", async () => {
    m.list.mockResolvedValue([
      { ...row, status: "succeeded", expiresAt: new Date(0) },
    ]);
    const result = await reportExportService.list(
      {
        organizationId: org,
        teamBindingId: team,
        brandId: "brand",
        page: 1,
        pageSize: 20,
      },
      "user",
    );
    expect(result.list[0]).toMatchObject({
      status: "expired",
      downloadUrl: null,
    });
  });
  it("权限撤销返回可理解的失败原因，未知错误不暴露内部异常", async () => {
    m.find.mockResolvedValue({
      ...row,
      status: "failed",
      errorCode: "REPORT_PERMISSION_REVOKED",
    });
    expect(await reportExportService.get("export", org, "user")).toMatchObject({
      errorMessage: "操作权限已变更，请联系企业管理员。",
    });
    m.find.mockResolvedValue({
      ...row,
      status: "failed",
      errorCode: "private stack or provider error",
    });
    expect(
      (await reportExportService.get("export", org, "user")).errorMessage,
    ).not.toContain("private");
  });
});
