"use client";

import {
  allocateBrandBalanceSchema,
  type AllocateBrandBalanceInput,
} from "@geo/contracts";
import {
  Alert,
  Button,
  Descriptions,
  Form,
  InputNumber,
  Select,
  Space,
  Typography,
  type SelectProps,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

type Values = { asset: AllocateBrandBalanceInput["asset"]; amount: number };
type Command = {
  input: AllocateBrandBalanceInput;
  organizationName: string;
  brandName: string;
};
type Ledger = AllocateBrandBalanceInput & {
  actorUserId: string | null;
  operation: string;
  referenceType: string;
  referenceId: string;
  brandId?: string | null;
};
function AssetSelect(
  props: SelectProps<Values["asset"]> & { "aria-required"?: boolean },
) {
  const forwarded = { ...props };
  delete forwarded["aria-required"];
  return <Select<Values["asset"]> {...forwarded} />;
}

// @project-doc docs/domains/balance_and_publication.md#balance_invariants
export function BrandAllocation({
  userId,
  organizationId,
  organizationName,
  brandId,
  brandName,
  canAllocate,
  pointsExpired,
  onAllocated,
}: {
  userId: string;
  organizationId: string;
  organizationName: string;
  brandId: string;
  brandName: string;
  canAllocate: boolean;
  pointsExpired: boolean;
  onAllocated: (message: string) => void | Promise<void>;
}) {
  const [form] = Form.useForm<Values>();
  const asset = Form.useWatch("asset", form) ?? "answerbit_points";
  const [pending, setPending] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [retryOriginal, setRetryOriginal] = useState(false),
    [ready, setReady] = useState(false),
    [recoveryError, setRecoveryError] = useState("");
  const mounted = useRef(true),
    inFlight = useRef(false);
  const storageKey = `geo:brand-allocation:v1:${userId}`;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const recover = useCallback(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const command = JSON.parse(saved) as Command;
        const parsed = allocateBrandBalanceSchema.safeParse(command.input);
        if (
          !parsed.success ||
          typeof command.organizationName !== "string" ||
          typeof command.brandName !== "string"
        )
          throw new Error("Invalid saved allocation");
        setPending({ ...command, input: parsed.data });
        setError("已恢复上次尚未核实的划拨，请先核对操作结果。");
      }
      setRecoveryError("");
      setReady(true);
    } catch {
      setRecoveryError(
        "无法读取上次划拨记录，请恢复浏览器存储后重试，避免重复划拨。",
      );
    }
  }, [storageKey]);
  useEffect(() => {
    recover();
  }, [recover]);
  const previousScope = useRef({ organizationId, brandId });
  useEffect(() => {
    const previous = previousScope.current;
    if (
      previous.organizationId !== organizationId ||
      (brandId && previous.brandId !== brandId)
    )
      form.resetFields();
    previousScope.current = {
      organizationId,
      brandId:
        brandId ||
        (previous.organizationId === organizationId ? previous.brandId : ""),
    };
  }, [form, organizationId, brandId]);
  function clearPending() {
    sessionStorage.removeItem(storageKey);
    setPending(null);
    setRetryOriginal(false);
  }
  function matches(transaction: Ledger, command: Command) {
    const input = command.input;
    return (
      transaction.organizationId === input.organizationId &&
      transaction.idempotencyKey === input.idempotencyKey &&
      transaction.actorUserId === userId &&
      transaction.operation === "allocate" &&
      transaction.referenceType === "brand_allocation" &&
      transaction.referenceId === input.brandId &&
      transaction.asset === input.asset &&
      transaction.amount === input.amount &&
      transaction.reason === input.reason
    );
  }
  async function finish(command: Command) {
    if (!mounted.current) return;
    clearPending();
    setError("");
    form.resetFields();
    await onAllocated(
      `${command.organizationName}已向${command.brandName}划拨${command.input.asset === "answerbit_points" ? `${command.input.amount.toLocaleString()} 积分` : `${(command.input.amount / 100).toFixed(2)} 元`}`,
    );
  }
  async function verify(command: Command) {
    const { organizationId, brandId, idempotencyKey } = command.input;
    const response = await fetch(
      `/api/v1/balance-allocations/confirmation?${new URLSearchParams({ organizationId, brandId, idempotencyKey })}`,
      { cache: "no-store" },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "核对划拨失败");
    if (!mounted.current) return;
    const transaction = body.data as Ledger | null;
    if (!transaction) {
      setRetryOriginal(true);
      setError(
        "尚未查到这次划拨。可以继续核对，或按原内容重试；不会生成新的请求。",
      );
      return;
    }
    if (!matches(transaction, command) || transaction.brandId !== brandId) {
      setRetryOriginal(false);
      setError(
        "原请求对应的流水与提交内容不一致，请联系平台管理员核对，勿再次划拨。",
      );
      return;
    }
    await finish(command);
  }
  async function send(command: Command, replay: boolean) {
    try {
      const response = await fetch("/api/v1/balance-allocations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command.input),
      });
      const body = await response.json();
      if (!mounted.current) return;
      if (!response.ok) {
        if (response.status >= 500) throw new Error("Uncertain allocation");
        if (!replay && body.error?.code !== "IDEMPOTENCY_CONFLICT")
          clearPending();
        setRetryOriginal(false);
        setError(body.error?.message ?? "划拨未完成");
        return;
      }
      if (!matches(body.data?.transaction, command))
        throw new Error("Invalid allocation response");
      await finish(command);
    } catch {
      if (!mounted.current) return;
      try {
        await verify(command);
      } catch (reason) {
        if (mounted.current)
          setError(
            `划拨结果尚未核实，请先核对操作结果。${reason instanceof Error ? reason.message : ""}`,
          );
      }
    }
  }
  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : "划拨未完成");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const disabled =
    !ready ||
    Boolean(recoveryError) ||
    !canAllocate ||
    !brandId ||
    (asset === "answerbit_points" && pointsExpired);
  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      {recoveryError ? (
        <Alert
          type="error"
          showIcon
          message={recoveryError}
          action={<Button onClick={recover}>重试恢复划拨记录</Button>}
        />
      ) : null}
      {error ? <Alert type="error" showIcon message={error} /> : null}
      {pending ? (
        <>
          <Descriptions
            column={1}
            size="small"
            items={[
              {
                key: "org",
                label: "原企业",
                children: pending.organizationName,
              },
              {
                key: "brand",
                label: "目标品牌",
                children: (
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      minWidth: 0,
                      overflowWrap: "anywhere",
                    }}
                  >
                    <Typography.Text>{pending.brandName}</Typography.Text>
                    <Typography.Text type="secondary">
                      {pending.input.brandId}
                    </Typography.Text>
                  </span>
                ),
              },
              {
                key: "amount",
                label: "划拨数量",
                children:
                  pending.input.asset === "answerbit_points"
                    ? `${pending.input.amount.toLocaleString()} 积分`
                    : `${(pending.input.amount / 100).toFixed(2)} 元`,
              },
            ]}
          />
          <Space wrap>
            <Button
              type="primary"
              loading={busy}
              onClick={() => void run(() => verify(pending))}
            >
              核对操作结果
            </Button>
            {retryOriginal ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setRetryOriginal(false);
                    await send(pending, true);
                  })
                }
              >
                按原内容重试
              </Button>
            ) : null}
          </Space>
        </>
      ) : (
        <Form<Values>
          form={form}
          name="brand_asset_allocation"
          initialValues={{ asset: "answerbit_points" }}
          layout="vertical"
          disabled={
            busy || !ready || Boolean(recoveryError) || !canAllocate || !brandId
          }
          onFinish={(values) => {
            if (disabled) return;
            void run(async () => {
              const command: Command = {
                organizationName,
                brandName,
                input: allocateBrandBalanceSchema.parse({
                  organizationId,
                  brandId,
                  asset: values.asset,
                  amount:
                    values.asset === "publication_cny"
                      ? Math.round(values.amount * 100)
                      : values.amount,
                  idempotencyKey: crypto.randomUUID(),
                }),
              };
              try {
                sessionStorage.setItem(storageKey, JSON.stringify(command));
              } catch {
                throw new Error(
                  "浏览器无法保存划拨记录，请允许本页存储后再提交，尚未划拨。",
                );
              }
              setPending(command);
              setRetryOriginal(false);
              await send(command, false);
            });
          }}
        >
          <Form.Item label="资产类型" name="asset" rules={[{ required: true }]}>
            <AssetSelect
              aria-label="资产类型"
              options={[
                { label: "腾讯能力积分", value: "answerbit_points" },
                { label: "发布人民币余额（元）", value: "publication_cny" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="划拨数量"
            name="amount"
            dependencies={["asset"]}
            rules={[
              { required: true, message: "请输入划拨数量" },
              ({ getFieldValue }) => ({
                validator: async (_, value: number | null) => {
                  if (value == null) return;
                  const points = getFieldValue("asset") === "answerbit_points",
                    units = points ? value : value * 100;
                  if (
                    value <= 0 ||
                    !Number.isFinite(units) ||
                    (points
                      ? !Number.isSafeInteger(units)
                      : Math.abs(units - Math.round(units)) > 1e-7) ||
                    Math.round(units) < 1 ||
                    Math.round(units) > 1_000_000_000
                  )
                    throw new Error(
                      points
                        ? "积分须为 1 至 10 亿的整数"
                        : "金额须为 0.01 至 1000 万元，最多两位小数",
                    );
                },
              }),
            ]}
          >
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
          <Button
            block
            htmlType="submit"
            loading={busy}
            type="primary"
            disabled={disabled}
          >
            确认划拨
          </Button>
        </Form>
      )}
    </Space>
  );
}
