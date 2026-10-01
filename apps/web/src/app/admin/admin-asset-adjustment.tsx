"use client";

import { adminDeductBalanceSchema } from "@geo/contracts";
import {
  Alert,
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Typography,
  type SelectProps,
} from "antd";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { AdminOrganization } from "./admin-organization-directory";

type Values = {
  operation: "grant" | "deduct";
  account: "enterprise" | "brand";
  asset: "answerbit_points" | "publication_cny";
  amount: number;
  reason: string;
};
type Command = {
  organization: Pick<AdminOrganization, "id" | "name" | "answerbitBrandId">;
  operation: Values["operation"];
  input: {
    organizationId: string;
    brandId?: string;
    asset: Values["asset"];
    amount: number;
    reason: string;
    idempotencyKey: string;
  };
};
type Ledger = {
  id: string;
  organizationId: string;
  brandId: string | null;
  asset: string;
  operation: string;
  referenceType: string;
  amount: number;
  reason: string;
  actorUserId: string | null;
  idempotencyKey: string;
};

function RequiredRadioGroup({
  label,
  "aria-required": required,
  ...props
}: ComponentProps<typeof Radio.Group> & {
  label: string;
  "aria-required"?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} aria-required={required}>
      <Radio.Group {...props} />
    </div>
  );
}

function AssetSelect(
  props: SelectProps<Values["asset"]> & { "aria-required"?: boolean },
) {
  const forwarded = { ...props };
  // Select forwards Form's required attribute to a non-semantic outer div.
  // Keep the visible required label and validation without that invalid attribute.
  delete forwarded["aria-required"];
  return <Select<Values["asset"]> {...forwarded} />;
}

// @project-doc docs/domains/balance_and_publication.md#balance_invariants
export function AdminAssetAdjustment({
  organization,
  userId,
  onRecover,
  onClose,
  onSaved,
}: {
  organization: Command["organization"] | null;
  userId: string;
  onRecover: (organization: Command["organization"]) => void;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const [form] = Form.useForm<Values>();
  const [pending, setPending] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [retryOriginal, setRetryOriginal] = useState(false);
  const inFlight = useRef(false),
    mounted = useRef(true);
  const storageKey = `geo:admin-asset-adjustment:v1:${userId}`;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (!saved) return;
      const command = JSON.parse(saved) as Command;
      const parsed = adminDeductBalanceSchema.safeParse(command.input);
      if (
        !parsed.success ||
        !["grant", "deduct"].includes(command.operation) ||
        command.organization?.id !== parsed.data.organizationId ||
        typeof command.organization.name !== "string" ||
        (command.operation === "grant" && parsed.data.brandId)
      )
        throw new Error("invalid pending command");
      const restored = { ...command, input: parsed.data };
      setPending(restored);
      onRecover(restored.organization);
      setError("已恢复上次尚未核实的资产调整，请先核对操作结果。");
    } catch {
      setError("无法恢复上次资产调整，请先核对平台流水，避免重复操作。");
    }
    // The recovery callback is a stable parent state setter; read the browser draft once per signed-in user.
  }, [storageKey, onRecover]);
  useEffect(() => {
    if (!organization) return;
    form.resetFields();
  }, [form, organization]);
  useEffect(() => {
    if (pending)
      form.setFieldsValue({
        operation: pending.operation,
        account: pending.input.brandId ? "brand" : "enterprise",
        asset: pending.input.asset,
        amount:
          pending.input.asset === "publication_cny"
            ? pending.input.amount / 100
            : pending.input.amount,
        reason: pending.input.reason,
      });
  }, [form, pending, organization]);

  function clearPending() {
    sessionStorage.removeItem(storageKey);
    setPending(null);
    setRetryOriginal(false);
  }
  async function finish(command: Command) {
    if (!mounted.current) return;
    clearPending();
    setError("");
    onClose();
    try {
      await onSaved(
        command.operation === "grant"
          ? "余额已入账，已记录资产流水与审计"
          : "扣减成功，已记录资产流水与审计",
      );
    } catch {
      if (mounted.current)
        setError("资产调整已完成，目录刷新失败，请刷新当前模块。");
    }
  }
  async function verify(command: Command) {
    const params = new URLSearchParams({
      organizationId: command.input.organizationId,
      idempotencyKey: command.input.idempotencyKey,
    });
    const response = await fetch(
      `/api/v1/admin/balance-transactions/confirmation?${params}`,
      { cache: "no-store" },
    );
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error?.message ?? "核对资产调整失败");
    if (!mounted.current) return;
    const transaction = body.data as Ledger | null;
    if (!transaction) {
      setRetryOriginal(true);
      setError(
        "尚未查到这次资产流水。可以继续核对，或按原内容重试；不会生成新的请求。",
      );
      return;
    }
    const input = command.input;
    if (
      transaction.organizationId !== input.organizationId ||
      transaction.idempotencyKey !== input.idempotencyKey ||
      transaction.actorUserId !== userId ||
      transaction.asset !== input.asset ||
      transaction.amount !== input.amount ||
      transaction.reason !== input.reason ||
      (transaction.brandId ?? undefined) !== input.brandId ||
      transaction.operation !==
        (command.operation === "grant" ? "grant" : "adjust") ||
      transaction.referenceType !==
        (command.operation === "grant" ? "manual_grant" : "admin_deduction")
    ) {
      setRetryOriginal(false);
      setError(
        "原请求对应的流水与提交内容不一致，请先核对平台流水，勿重新入账或扣减。",
      );
      return;
    }
    await finish(command);
  }
  async function send(command: Command, replay: boolean) {
    try {
      const response = await fetch(
        `/api/v1/admin/balance-${command.operation === "grant" ? "grants" : "deductions"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command.input),
        },
      );
      const body = await response.json();
      if (!mounted.current) return;
      if (!response.ok) {
        if (response.status >= 500)
          throw new Error(body.error?.message ?? "提交结果尚未核实");
        if (!replay) clearPending();
        setError(body.error?.message ?? "资产调整未完成");
        return;
      }
      await finish(command);
    } catch {
      if (!mounted.current) return;
      try {
        await verify(command);
      } catch {
        if (mounted.current)
          setError("提交结果尚未核实，请先核对操作结果，避免重复入账或扣减。");
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
        setError(reason instanceof Error ? reason.message : "资产调整未完成");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const target = pending?.organization ?? organization;
  return (
    <Modal
      open={Boolean(target)}
      title={`${target?.name ?? ""} · 资产调整`}
      footer={null}
      width={680}
      closable={!busy && !pending}
      maskClosable={!busy && !pending}
      keyboard={!busy && !pending}
      onCancel={() => {
        if (!busy && !pending) {
          setError("");
          onClose();
        }
      }}
    >
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          {target?.answerbitBrandId
            ? `BrandID：${target.answerbitBrandId}`
            : "企业资金池"}
        </Typography.Text>
        <Alert
          type="info"
          showIcon
          description="入账进入企业资金池；手动扣减可选择企业资金池或品牌账户，须填写原因并保留流水。"
        />
        {error ? <Alert type="error" showIcon message={error} /> : null}
        {pending ? (
          <Descriptions
            column={1}
            size="small"
            items={[
              {
                key: "operation",
                label: "操作",
                children: pending.operation === "grant" ? "入账" : "手动扣减",
              },
              {
                key: "account",
                label: "调整账户",
                children: pending.input.brandId ? "品牌账户" : "企业资金池",
              },
              {
                key: "asset",
                label: "资产",
                children:
                  pending.input.asset === "answerbit_points"
                    ? "腾讯能力积分"
                    : "发布人民币余额",
              },
              {
                key: "amount",
                label: "数量",
                children:
                  pending.input.asset === "answerbit_points"
                    ? `${pending.input.amount.toLocaleString()} 积分`
                    : `${(pending.input.amount / 100).toFixed(2)} 元`,
              },
              {
                key: "reason",
                label: "调整原因",
                children: pending.input.reason,
              },
            ]}
          />
        ) : null}
        <Form<Values>
          form={form}
          name="platform_asset_adjustment"
          layout="vertical"
          size="large"
          disabled={busy || Boolean(pending)}
          style={{ display: pending ? "none" : undefined }}
          initialValues={{
            asset: "answerbit_points",
            operation: "grant",
            account: "enterprise",
          }}
          onFinish={(values) => {
            if (!target || pending) return;
            void run(async () => {
              const command: Command = {
                organization: {
                  id: target.id,
                  name: target.name,
                  answerbitBrandId: target.answerbitBrandId,
                },
                operation: values.operation,
                input: {
                  organizationId: target.id,
                  brandId:
                    values.operation === "deduct" && values.account === "brand"
                      ? (target.answerbitBrandId ?? undefined)
                      : undefined,
                  asset: values.asset,
                  amount:
                    values.asset === "publication_cny"
                      ? Math.round(values.amount * 100)
                      : values.amount,
                  reason: values.reason.trim(),
                  idempotencyKey: crypto.randomUUID(),
                },
              };
              // Persist before sending: a refresh must recover the same financial request.
              try {
                sessionStorage.setItem(storageKey, JSON.stringify(command));
              } catch {
                throw new Error(
                  "浏览器无法保存操作记录，请允许本页存储后再提交，尚未入账或扣减。",
                );
              }
              setPending(command);
              setRetryOriginal(false);
              await send(command, false);
            });
          }}
        >
          <Form.Item label="操作" name="operation" rules={[{ required: true }]}>
            <RequiredRadioGroup
              label="操作"
              options={[
                { label: "入账", value: "grant" },
                { label: "手动扣减", value: "deduct" },
              ]}
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(a, b) => a.operation !== b.operation}
          >
            {({ getFieldValue }) =>
              getFieldValue("operation") === "deduct" ? (
                <Form.Item
                  label="扣减账户"
                  name="account"
                  rules={[{ required: true }]}
                >
                  <RequiredRadioGroup
                    label="扣减账户"
                    options={[
                      { label: "企业资金池", value: "enterprise" },
                      {
                        label: "品牌账户",
                        value: "brand",
                        disabled: !target?.answerbitBrandId,
                      },
                    ]}
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item label="资产" name="asset" rules={[{ required: true }]}>
            <AssetSelect
              options={[
                { label: "腾讯能力积分", value: "answerbit_points" },
                { label: "发布人民币余额（元）", value: "publication_cny" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="数量"
            name="amount"
            dependencies={["asset"]}
            rules={[
              { required: true, message: "请输入数量" },
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
          <Form.Item
            label="调整原因"
            name="reason"
            rules={[
              { required: true, whitespace: true, message: "请输入调整原因" },
              {
                validator: async (_, value: string) => {
                  if (
                    value &&
                    (value.trim().length < 4 || value.trim().length > 1000)
                  )
                    throw new Error("调整原因须为 4 至 1000 个字符");
                },
              },
            ]}
          >
            <Input maxLength={1000} />
          </Form.Item>
          {!pending ? (
            <Form.Item
              noStyle
              shouldUpdate={(a, b) => a.operation !== b.operation}
            >
              {({ getFieldValue }) => (
                <Button
                  block
                  htmlType="submit"
                  type="primary"
                  loading={busy}
                  danger={getFieldValue("operation") === "deduct"}
                >
                  {getFieldValue("operation") === "deduct"
                    ? "确认手动扣减"
                    : "确认入账"}
                </Button>
              )}
            </Form.Item>
          ) : null}
        </Form>
        {pending ? (
          <Space wrap>
            <Button
              type="primary"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await verify(pending);
                })
              }
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
        ) : null}
      </Space>
    </Modal>
  );
}
