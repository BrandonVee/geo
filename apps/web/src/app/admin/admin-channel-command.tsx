"use client";

import {
  updatePublicationChannelSchema,
  type UpdatePublicationChannelInput,
} from "@geo/contracts";
import {
  Alert,
  Button,
  Col,
  Descriptions,
  InputNumber,
  Modal,
  Row,
  Space,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";

const tiers = ["retail", "bronze", "silver", "gold"] as const;
type Tier = (typeof tiers)[number];
const labels: Record<Tier, string> = {
  retail: "普通用户",
  bronze: "铜牌代理",
  silver: "银牌代理",
  gold: "金牌代理",
};
const money = (amount: number) => `¥${(amount / 100).toFixed(2)}`;
export type ChannelSnapshot = {
  id: string;
  name: string;
  status: string;
  provider: string;
  providerCostAmount: number;
  basePriceAmount?: number;
  tierPrices: Record<Tier, { priceAmount: number; overridden: boolean }>;
};
export type ChannelCommandTarget = {
  channel: ChannelSnapshot;
  mode: "pricing" | "status";
};
type Pending = {
  target: ChannelCommandTarget;
  input: UpdatePublicationChannelInput;
};
const overrides = (channel: ChannelSnapshot) =>
  Object.fromEntries(
    tiers.map((tier) => [
      tier,
      channel.tierPrices[tier].overridden
        ? channel.tierPrices[tier].priceAmount
        : null,
    ]),
  ) as Record<Tier, number | null>;
function isSnapshot(value: unknown): value is ChannelSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as ChannelSnapshot;
  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    ["active", "inactive"].includes(row.status) &&
    ["manual", "frog_media"].includes(row.provider) &&
    Number.isSafeInteger(row.providerCostAmount) &&
    row.providerCostAmount >= 0 &&
    tiers.every(
      (tier) =>
        Number.isSafeInteger(row.tierPrices?.[tier]?.priceAmount) &&
        row.tierPrices[tier].priceAmount >= 0 &&
        typeof row.tierPrices[tier].overridden === "boolean",
    )
  );
}
function matches(
  current: ChannelSnapshot,
  input: UpdatePublicationChannelInput,
) {
  if (input.status !== undefined && current.status !== input.status)
    return false;
  const prices = overrides(current);
  return (
    !input.tierPrices ||
    tiers.every((tier) => prices[tier] === input.tierPrices![tier])
  );
}

// @project-doc docs/domains/balance_and_publication.md#publication_channel_updates
export function AdminChannelCommand({
  target,
  userId,
  onClose,
  onSaved,
}: {
  target: ChannelCommandTarget | null;
  userId: string;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const key = `geo:admin-channel-command:v1:${userId}`;
  const [pending, setPending] = useState<Pending | null>(null);
  const [recoveredTarget, setRecoveredTarget] =
    useState<ChannelCommandTarget | null>(null);
  const [recoveryError, setRecoveryError] = useState("");
  useEffect(() => {
    setPending(null);
    setRecoveredTarget(null);
    setRecoveryError("");
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw) as Pending;
      const input = updatePublicationChannelSchema.safeParse(saved.input);
      if (
        !isSnapshot(saved.target?.channel) ||
        !["pricing", "status"].includes(saved.target.mode) ||
        !input.success ||
        !input.data.expected ||
        (saved.target.mode === "pricing"
          ? !input.data.tierPrices
          : !input.data.status)
      )
        throw new Error("Invalid channel command");
      setRecoveredTarget(saved.target);
      setPending({ target: saved.target, input: input.data });
    } catch {
      setRecoveryError(
        "上次渠道操作记录无法读取，请先刷新并核对渠道当前售价和状态。",
      );
    }
  }, [key]);
  const selected = pending?.target ?? recoveredTarget ?? target;
  function clear() {
    try {
      sessionStorage.removeItem(key);
    } catch {
      setRecoveryError(
        "渠道操作结果已核对，但浏览器暂存记录未能清除。刷新后请再次只读核对结果。",
      );
    }
    setPending(null);
  }
  return (
    <>
      {recoveryError ? (
        <Alert
          type="warning"
          showIcon
          message={recoveryError}
          closable
          onClose={() => setRecoveryError("")}
        />
      ) : null}
      {selected ? (
        <ChannelDialog
          key={`${selected.channel.id}:${selected.mode}`}
          target={selected}
          initialPending={pending}
          persist={(command) => {
            sessionStorage.setItem(key, JSON.stringify(command));
            setPending(command);
          }}
          clear={clear}
          onClose={() => {
            setRecoveredTarget(null);
            onClose();
          }}
          onSaved={onSaved}
        />
      ) : null}
    </>
  );
}

function ChannelDialog({
  target,
  initialPending,
  persist,
  clear,
  onClose,
  onSaved,
}: {
  target: ChannelCommandTarget;
  initialPending: Pending | null;
  persist: (command: Pending) => void;
  clear: () => void;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [baseline, setBaseline] = useState(target.channel);
  const [values, setValues] = useState<Record<Tier, string | null>>(() => {
    const prices =
      initialPending?.input.tierPrices ?? overrides(target.channel);
    return Object.fromEntries(
      tiers.map((tier) => [
        tier,
        prices[tier] === null ? null : String(prices[tier]! / 100),
      ]),
    ) as Record<Tier, string | null>;
  });
  const [desiredStatus] = useState(
    initialPending?.input.status ??
      (target.channel.status === "active" ? "inactive" : "active"),
  );
  const [checking, setChecking] = useState(Boolean(initialPending));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    initialPending ? "已恢复上次尚未核实的渠道操作，请先核对结果。" : "",
  );
  const [latest, setLatest] = useState<ChannelSnapshot | null>(null);
  const command = useRef<Pending | null>(initialPending);
  const inFlight = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pricing = target.mode === "pricing";
  const locked = busy || checking || Boolean(latest);
  const closeLocked = busy || checking;
  async function finish() {
    if (!mounted.current) return;
    clear();
    command.current = null;
    setChecking(false);
    onClose();
    await onSaved(
      pricing
        ? "渠道分级售价已保存"
        : desiredStatus === "active"
          ? "渠道已启用"
          : "渠道已下架",
    );
  }
  async function verify() {
    if (!command.current) return;
    const response = await fetch(
      `/api/v1/admin/publication-channels/${baseline.id}`,
      { cache: "no-store" },
    );
    const body = await response.json();
    if (!response.ok || !isSnapshot(body.data) || body.data.id !== baseline.id)
      throw new Error(body.error?.message ?? "未能读取渠道最新设置");
    if (!mounted.current) return;
    if (matches(body.data, command.current.input)) return finish();
    clear();
    command.current = null;
    setChecking(false);
    setLatest(body.data);
    setError(
      "当前设置与原提交不同，请核对最新设置后决定是否继续。原输入已保留。",
    );
  }
  async function submit() {
    if (inFlight.current || latest) return;
    let input: UpdatePublicationChannelInput | undefined;
    if (!checking) {
      if (pricing) {
        const prices = {} as Record<Tier, number | null>;
        for (const tier of tiers) {
          const value = values[tier];
          if (value === null || value === "") {
            prices[tier] = null;
            continue;
          }
          if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
            setError(`${labels[tier]}售价最多保留两位小数，请填写非负金额。`);
            return;
          }
          const [whole, fraction = ""] = value.split(".");
          const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
          if (!Number.isSafeInteger(cents) || cents > 1_000_000_000) {
            setError(`${labels[tier]}售价不能超过 1000 万元。`);
            return;
          }
          if (
            baseline.provider === "frog_media" &&
            cents < baseline.providerCostAmount
          ) {
            setError(
              `${labels[tier]}售价不能低于当前采购成本 ${money(baseline.providerCostAmount)}。`,
            );
            return;
          }
          prices[tier] = cents;
        }
        input = {
          tierPrices: prices,
          expected: { tierPrices: overrides(baseline) },
        };
      } else {
        input = {
          status: desiredStatus,
          expected: { status: baseline.status as "active" | "inactive" },
        };
      }
      const pending = { target: { ...target, channel: baseline }, input };
      try {
        persist(pending);
      } catch {
        setError(
          "暂时无法保存待核对操作，请启用浏览器会话存储后重试。本次尚未发送。",
        );
        return;
      }
      command.current = pending;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (checking) {
        await verify();
        return;
      }
      const response = await fetch(
        `/api/v1/admin/publication-channels/${baseline.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        if (response.status >= 500)
          throw new Error(body.error?.message ?? "提交结果尚未核实");
        if (!mounted.current) return;
        clear();
        command.current = null;
        setError(body.error?.message ?? "渠道变更未保存");
        if (
          isSnapshot(body.error?.details?.current) &&
          body.error.details.current.id === baseline.id
        )
          setLatest(body.error.details.current);
        return;
      }
      if (
        !isSnapshot(body.data) ||
        body.data.id !== baseline.id ||
        !matches(body.data, input!)
      )
        throw new Error("渠道保存响应不完整");
      await finish();
    } catch {
      if (!mounted.current) return;
      setChecking(true);
      try {
        await verify();
      } catch {
        if (mounted.current)
          setError(
            "提交结果尚未核实，请先核对操作结果，避免覆盖其他管理员的变更。",
          );
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const okText = checking
    ? "核对操作结果"
    : pricing
      ? "保存分级售价"
      : desiredStatus === "active"
        ? "确认启用"
        : "确认下架";
  return (
    <Modal
      open
      title={
        pricing
          ? `分级定价 · ${baseline.name}`
          : `${desiredStatus === "active" ? "启用" : "下架"}渠道 · ${baseline.name}`
      }
      width={760}
      okText={okText}
      cancelText="取消"
      confirmLoading={busy}
      okButtonProps={{
        disabled: busy || Boolean(latest),
        "aria-label": okText,
        danger: !pricing && desiredStatus === "inactive",
      }}
      cancelButtonProps={{ disabled: closeLocked }}
      closable={!closeLocked}
      maskClosable={!closeLocked}
      keyboard={!closeLocked}
      onCancel={() => {
        if (!closeLocked) onClose();
      }}
      onOk={() => void submit()}
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="渠道">{baseline.name}</Descriptions.Item>
          <Descriptions.Item label="采购成本">
            {baseline.provider === "frog_media"
              ? money(baseline.providerCostAmount)
              : "自营渠道"}
          </Descriptions.Item>
          <Descriptions.Item label="平台状态">
            {baseline.status === "active" ? "启用" : "下架"}
          </Descriptions.Item>
        </Descriptions>
        {error ? (
          <Alert
            showIcon
            type={checking || latest ? "warning" : "error"}
            message={error}
          />
        ) : null}
        {latest ? (
          <Alert
            type="warning"
            showIcon
            message="渠道设置已变化"
            description={
              <Space direction="vertical">
                <Typography.Text>
                  最新平台状态：{latest.status === "active" ? "启用" : "下架"}；
                  {latest.provider === "frog_media"
                    ? `最新采购成本：${money(latest.providerCostAmount)}`
                    : `人工基础价：${money(latest.basePriceAmount ?? 0)}`}
                </Typography.Text>
                {pricing
                  ? tiers.map((tier) => (
                      <Typography.Text key={tier}>
                        {labels[tier]}：
                        {money(latest.tierPrices[tier].priceAmount)}（
                        {latest.tierPrices[tier].overridden
                          ? "固定价"
                          : "自动定价"}
                        ）
                      </Typography.Text>
                    ))
                  : null}
                <Button
                  onClick={() => {
                    setBaseline(latest);
                    setLatest(null);
                    setError("");
                  }}
                >
                  已核对最新设置，保留输入继续
                </Button>
              </Space>
            }
          />
        ) : null}
        {pricing ? (
          <>
            <Typography.Paragraph style={{ marginBottom: 0 }} type="secondary">
              留空使用
              {baseline.provider === "frog_media"
                ? "等级加价规则自动计算，固定售价不得低于采购成本"
                : "人工基础价"}
              。此次仅调整四级售价。
            </Typography.Paragraph>
            <Row gutter={[12, 16]} style={{ width: "100%" }}>
              {tiers.map((tier) => (
                <Col key={tier} md={12} xs={24}>
                  <label htmlFor={`channel-price-${tier}`}>
                    {labels[tier]}
                  </label>
                  <InputNumber<string>
                    id={`channel-price-${tier}`}
                    aria-label={`${labels[tier]}固定售价`}
                    stringMode
                    suffix="元"
                    disabled={locked}
                    onChange={(value) =>
                      setValues((current) => ({ ...current, [tier]: value }))
                    }
                    placeholder="留空使用自动定价"
                    style={{ marginTop: 8, width: "100%" }}
                    value={values[tier]}
                  />
                  <Typography.Text type="secondary">
                    当前售价 {money(baseline.tierPrices[tier].priceAmount)}
                    {baseline.tierPrices[tier].overridden
                      ? " · 固定价"
                      : " · 自动定价"}
                  </Typography.Text>
                </Col>
              ))}
            </Row>
          </>
        ) : (
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            {desiredStatus === "inactive"
              ? "下架后客户无法使用该渠道创建新订单，已有订单继续履约。"
              : "启用后，上游接单状态正常的渠道将可供客户投稿。"}
          </Typography.Paragraph>
        )}
      </Space>
    </Modal>
  );
}
