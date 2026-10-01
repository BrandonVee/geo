"use client";

import { Alert, Button, Card, Popconfirm, Space, Typography } from "antd";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  publicationTrackingSourceSchema,
  type PublicationTrackingSource as Source,
} from "@geo/contracts";

// @project-doc docs/domains/geo_operations.md#article_tracking
export function PublicationTrackingSource({
  organizationId,
  teamBindingId,
  brandId,
  canUse,
  ready,
  hasDraft,
  pending,
  onUse,
  onContinue,
  onDismiss,
}: {
  organizationId: string;
  teamBindingId: string;
  brandId: string;
  canUse: boolean;
  ready: boolean;
  hasDraft: boolean;
  pending: boolean;
  onUse: (source: Source) => void;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const params = useSearchParams();
  const orderId = params.get("publicationOrderId");
  const requestedOrganizationId = params.get("organizationId");
  const requestedBrandId = params.get("brandId");
  const matches =
    organizationId === requestedOrganizationId && brandId === requestedBrandId;
  const key = JSON.stringify([orderId, organizationId, teamBindingId, brandId]);
  const [result, setResult] = useState<{
    key: string;
    source?: Source;
    error?: string;
  }>();
  const [retry, setRetry] = useState(0);
  const considered = useRef("");
  const active = result?.key === key && matches ? result : undefined;
  useEffect(() => {
    if (!orderId || !matches || !teamBindingId || !canUse) return;
    const controller = new AbortController();
    setResult(undefined);
    const query = new URLSearchParams({
      organizationId,
      teamBindingId,
      brandId,
    });
    fetch(
      `/api/v1/publication-orders/${encodeURIComponent(orderId)}/tracking-source?${query}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error?.message ?? "发布内容读取失败");
        const source = publicationTrackingSourceSchema.parse(body.data);
        if (source.orderId !== orderId) throw new Error("发布订单来源不一致");
        if (!controller.signal.aborted) setResult({ key, source });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            error: error instanceof Error ? error.message : "发布内容读取失败",
          });
      });
    return () => controller.abort();
  }, [
    orderId,
    matches,
    organizationId,
    teamBindingId,
    brandId,
    canUse,
    key,
    retry,
  ]);
  useEffect(() => {
    if (!active?.source || !ready || considered.current === key) return;
    considered.current = key;
    if (!hasDraft && !pending) onUse(active.source);
  }, [active, ready, hasDraft, pending, onUse, key]);
  if (!orderId || !brandId) return null;
  if (!matches)
    return (
      <Alert
        type="info"
        showIcon
        message="请在订单对应的企业与品牌加入效果追踪"
        action={<Button onClick={onDismiss}>关闭</Button>}
      />
    );
  if (!canUse)
    return (
      <Alert
        type="warning"
        showIcon
        message="当前范围没有发布或追踪权限"
        action={<Button onClick={onDismiss}>关闭</Button>}
      />
    );
  if (active?.error)
    return (
      <Alert
        type="error"
        showIcon
        message={active.error}
        action={
          <Space wrap>
            <Button onClick={() => setRetry((value) => value + 1)}>重试</Button>
            <Button onClick={onDismiss}>关闭</Button>
          </Space>
        }
      />
    );
  const source = active?.source;
  return (
    <Card title="已发布内容待追踪" loading={!source}>
      {source ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text strong>{source.title}</Typography.Text>
          <Typography.Link href={source.url} target="_blank" rel="noreferrer">
            查看发布结果
          </Typography.Link>
          <Typography.Text type="secondary">
            {pending
              ? "请先确认已有追踪提交，再使用这篇发布内容。"
              : hasDraft
                ? "当前品牌已有暂存输入，请选择继续编辑或使用这篇发布内容。"
                : "使用这篇发布内容填写追踪表单。"}
          </Typography.Text>
          <Space wrap>
            {hasDraft ? (
              <Popconfirm
                title="使用这篇发布内容？"
                description="将替换当前追踪草稿的标题、链接和标签。"
                okText="使用发布内容"
                cancelText="保留草稿"
                disabled={pending || !ready}
                onConfirm={() => onUse(source)}
              >
                <Button type="primary" disabled={pending || !ready}>
                  使用发布内容
                </Button>
              </Popconfirm>
            ) : (
              <Button
                type="primary"
                disabled={pending || !ready}
                onClick={() => onUse(source)}
              >
                使用发布内容
              </Button>
            )}
            <Button onClick={onContinue} disabled={!ready}>
              {pending ? "先确认已有提交" : "继续编辑原草稿"}
            </Button>
            <Button onClick={onDismiss}>暂不追踪</Button>
          </Space>
        </Space>
      ) : null}
    </Card>
  );
}
