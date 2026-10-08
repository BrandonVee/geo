"use client";

import { CopyOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  publicationManuscriptSchema,
  type PublicationManuscript,
} from "@geo/contracts";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Flex,
  Input,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { useEffect, useId, useRef, useState } from "react";

export type PublicationManuscriptTarget = {
  orderId: string;
  title: string;
  requestUrl: string;
  context?: string;
};

const sourceLabels: Record<PublicationManuscript["source"]["kind"], string> = {
  inline_html: "手工正文",
  url: "原文链接",
  document: "文档库",
  generated: "AI 生成任务",
  unknown: "历史来源未知",
};

function safeLink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// @project-doc docs/domains/balance_and_publication.md#publication_manuscripts
export function PublicationManuscriptDrawer({
  target,
  onClose,
}: {
  target: PublicationManuscriptTarget | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      title="投稿原稿"
      open={Boolean(target)}
      onClose={onClose}
      width={760}
      destroyOnHidden
      styles={{ body: { overflowWrap: "anywhere" } }}
    >
      {target ? (
        <ManuscriptContent key={target.requestUrl} target={target} />
      ) : null}
    </Drawer>
  );
}

function ManuscriptContent({
  target,
}: {
  target: PublicationManuscriptTarget;
}) {
  const [data, setData] = useState<PublicationManuscript | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [copying, setCopying] = useState(false);
  const [copyResult, setCopyResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const bodyId = useId();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    setLoading(true);
    async function read() {
      try {
        const response = await fetch(target.requestUrl, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error?.message ?? "稿件读取失败，请重试");
        const parsed = publicationManuscriptSchema.safeParse(body.data);
        if (!parsed.success || parsed.data.orderId !== target.orderId)
          throw new Error("稿件响应不完整，请重试读取");
        if (!controller.signal.aborted) setData(parsed.data);
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "稿件读取失败，请重试",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void read();
    return () => controller.abort();
  }, [target.requestUrl, target.orderId, retry]);

  async function copyManuscript() {
    if (!data?.contentHtml || copying) return;
    setCopying(true);
    setCopyResult(null);
    try {
      await navigator.clipboard.writeText(data.contentHtml);
      if (mounted.current)
        setCopyResult({ type: "success", message: "投稿正文已复制" });
    } catch {
      if (mounted.current)
        setCopyResult({
          type: "error",
          message: "无法访问剪贴板，请在下方正文中全选并复制。",
        });
    } finally {
      if (mounted.current) setCopying(false);
    }
  }

  const link = safeLink(data?.contentUrl ?? null);
  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <div>
        <Typography.Text strong>{data?.title ?? target.title}</Typography.Text>
        {target.context ? (
          <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
            {target.context}
          </Typography.Paragraph>
        ) : null}
      </div>
      {loading ? (
        <div role="status" aria-label="正在读取投稿原稿">
          <Typography.Paragraph type="secondary">
            正在读取投稿原稿…
          </Typography.Paragraph>
          <Skeleton active paragraph={{ rows: 6 }} title={false} />
        </div>
      ) : null}
      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button
              aria-label="重试读取稿件"
              icon={<ReloadOutlined aria-hidden />}
              onClick={() => setRetry((value) => value + 1)}
            >
              重试读取稿件
            </Button>
          }
        />
      ) : null}
      {data ? (
        <>
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="订单编号">
              <Typography.Text copyable>{data.orderId}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="提交时间（北京时间）">
              {new Date(data.submittedAt).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
              })}
            </Descriptions.Item>
            <Descriptions.Item label="稿件来源">
              <Tag>
                {sourceLabels[data.source.kind]}
                {data.source.documentVersion
                  ? ` · v${data.source.documentVersion}`
                  : ""}
              </Tag>
            </Descriptions.Item>
            {data.source.documentId || data.source.jobId ? (
              <Descriptions.Item
                label={data.source.documentId ? "来源文档编号" : "来源任务编号"}
              >
                <Typography.Text copyable>
                  {data.source.documentId ?? data.source.jobId}
                </Typography.Text>
              </Descriptions.Item>
            ) : null}
          </Descriptions>
          {data.snapshotStatus === "legacy_unavailable" ? (
            <Alert
              type="warning"
              showIcon
              message="该历史订单未保存投稿时快照"
              description="无法还原当时的正文和发布要求。下方仅展示订单保留的来源信息，请联系原投稿人核对。"
            />
          ) : (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              以下为本次提交时保存的稿件，后续修改来源文章或履约说明不会改变原稿。
            </Typography.Paragraph>
          )}
          {data.contentUrl ? (
            <Flex vertical gap={8}>
              <Typography.Text strong>投稿链接</Typography.Text>
              {link ? (
                <Typography.Link
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {data.contentUrl}
                </Typography.Link>
              ) : (
                <Typography.Text>{data.contentUrl}</Typography.Text>
              )}
            </Flex>
          ) : null}
          {data.contentHtml ? (
            <Flex vertical gap={8}>
              <Flex align="center" justify="space-between" wrap gap={8}>
                <label htmlFor={bodyId}>投稿时正文（HTML 原文）</label>
                <Button
                  icon={<CopyOutlined aria-hidden />}
                  onClick={() => void copyManuscript()}
                  loading={copying}
                  disabled={copying}
                  aria-label="复制投稿正文"
                  aria-busy={copying}
                >
                  复制投稿正文
                </Button>
              </Flex>
              {copyResult ? (
                <Alert
                  showIcon
                  type={copyResult.type}
                  message={copyResult.message}
                  closable
                  onClose={() => setCopyResult(null)}
                />
              ) : null}
              <Input.TextArea
                id={bodyId}
                readOnly
                value={data.contentHtml}
                autoSize={{ minRows: 12, maxRows: 24 }}
              />
            </Flex>
          ) : data.snapshotStatus === "available" ? (
            <Alert
              type="info"
              showIcon
              message={
                data.source.kind === "url"
                  ? "本单以原文链接投稿，未提交正文。"
                  : "本次稿件未包含正文，请核对投稿链接。"
              }
            />
          ) : null}
          {data.snapshotStatus === "available" ? (
            <Flex vertical gap={8}>
              <Typography.Text strong>原发布要求</Typography.Text>
              <Typography.Paragraph
                style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}
              >
                {data.submissionNote || "未填写发布要求"}
              </Typography.Paragraph>
            </Flex>
          ) : null}
        </>
      ) : null}
    </Space>
  );
}
