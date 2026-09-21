"use client";

import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Pagination,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import type {
  PublicationChannel,
  PublicationChannelQuery,
} from "../../billing/publication-channel";
import styles from "../../billing/publication-channel-picker.module.css";

type SortMode = PublicationChannelQuery["sort"];
type PageData<T> = {
  list: T[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};
type DraftContext = {
  title?: string;
  sourceJobId?: string;
  sourceDocumentId?: string;
  note?: string;
};

const PAGE_SIZE = 12;
const money = (amount: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(amount / 100);

function publishTime(seconds: number | null | undefined) {
  if (!seconds) return "待统计";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} 分钟`;
  if (seconds < 86_400)
    return `${Math.max(1, Math.round(seconds / 3600))} 小时`;
  return `${Math.max(1, Math.round(seconds / 86_400))} 天`;
}

function channelTitles(channel: PublicationChannel) {
  return Object.values(channel.providerMetadata?.fieldTitles ?? {})
    .flat()
    .filter(Boolean);
}

function ChannelMetrics({ channel }: { channel: PublicationChannel }) {
  const metadata = channel.providerMetadata;
  return (
    <div className={styles.metrics}>
      <span>
        <strong>{metadata?.publishRate || "—"}</strong>
        <small>出稿率%</small>
      </span>
      <span>
        <strong>{metadata?.pcWeight || "—"}</strong>
        <small>PC 权重</small>
      </span>
      <span>
        <strong>{metadata?.wapWeight || "—"}</strong>
        <small>移动权重</small>
      </span>
      <span>
        <strong>{publishTime(metadata?.publishTimeSeconds)}</strong>
        <small>平均出稿</small>
      </span>
    </div>
  );
}

export function PublicationChannelsClient({ draft }: { draft: DraftContext }) {
  const [channels, setChannels] = useState<PublicationChannel[]>([]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [mediaType, setMediaType] = useState("all");
  const [maxPriceYuan, setMaxPriceYuan] = useState<number | null>(null);
  const [sort, setSort] = useState<SortMode>("recommended");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sort,
      });
      if (keyword.trim()) params.set("q", keyword.trim());
      if (mediaType !== "all") params.set("mediaType", mediaType);
      if (maxPriceYuan !== null)
        params.set("maxPriceAmount", String(Math.round(maxPriceYuan * 100)));
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/v1/publication-channels?${params}`, {
          cache: "no-store",
          signal,
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error?.message ?? "发布渠道加载失败");
        const data = body.data as PageData<PublicationChannel>;
        setChannels(data.list);
        setTotal(data.pagination.total);
      } catch (reason) {
        if (!signal?.aborted)
          setError(
            reason instanceof Error ? reason.message : "发布渠道加载失败",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [keyword, maxPriceYuan, mediaType, page, sort],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  useEffect(() => setPage(1), [keyword, maxPriceYuan, mediaType, sort]);

  const publicationHref = (channelId: string) => {
    const params = new URLSearchParams({ channelId });
    if (draft.title) params.set("title", draft.title);
    if (draft.sourceJobId) params.set("sourceJobId", draft.sourceJobId);
    if (draft.sourceDocumentId)
      params.set("sourceDocumentId", draft.sourceDocumentId);
    if (draft.note) params.set("note", draft.note);
    return `/dashboard/publication/new?${params}`;
  };

  return (
    <Space
      direction="vertical"
      size="large"
      style={{ padding: 24, width: "100%" }}
    >
      <Card>
        <div className={styles.filters}>
          <Input
            allowClear
            aria-label="搜索媒体名称、行业或发布要求"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索媒体、行业或发布要求"
            prefix={<SearchOutlined />}
            value={keyword}
          />
          <Segmented
            onChange={setMediaType}
            options={[
              { label: "全部", value: "all" },
              { label: "网站媒体", value: "website" },
              { label: "自媒体", value: "wemedia" },
              { label: "人工渠道", value: "manual" },
            ]}
            value={mediaType}
          />
          <InputNumber
            aria-label="最高发布价格"
            min={0}
            onChange={setMaxPriceYuan}
            placeholder="不限预算"
            precision={2}
            suffix="元以内"
            value={maxPriceYuan}
          />
          <Select<SortMode>
            aria-label="渠道排序"
            onChange={setSort}
            options={[
              { label: "综合推荐", value: "recommended" },
              { label: "价格从低到高", value: "priceAsc" },
              { label: "出稿率从高到低", value: "rateDesc" },
              { label: "平均出稿最快", value: "speedAsc" },
            ]}
            value={sort}
          />
        </div>

        <div className={styles.resultBar}>
          <Typography.Text>
            找到 <strong>{total.toLocaleString()}</strong> 个可用渠道
          </Typography.Text>
          <Typography.Text type="secondary">
            售价按当前账户等级和渠道规则计算
          </Typography.Text>
        </div>

        {error ? (
          <Empty description={error} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Spin spinning={loading}>
            {channels.length ? (
              <div className={styles.grid}>
                {channels.map((channel) => (
                  <article className={styles.channelCard} key={channel.id}>
                    <div className={styles.cardHeader}>
                      <span>
                        <Tag bordered={false}>
                          {channel.providerMediaType === "wemedia"
                            ? "自媒体"
                            : channel.provider === "frog_media"
                              ? "网站媒体"
                              : "人工"}
                        </Tag>
                        <strong>{channel.name}</strong>
                      </span>
                    </div>
                    <div className={styles.cardPrice}>
                      {money(channel.priceAmount)}
                    </div>
                    <ChannelMetrics channel={channel} />
                    <div className={styles.cardTags}>
                      {channelTitles(channel)
                        .slice(0, 4)
                        .map((title) => (
                          <span key={title}>{title}</span>
                        ))}
                    </div>
                    <p>{channel.remarks || "暂无额外发布要求"}</p>
                    <Button
                      block
                      href={publicationHref(channel.id)}
                      icon={<CheckCircleOutlined />}
                      type="primary"
                    >
                      选择并填写发布内容
                    </Button>
                  </article>
                ))}
              </div>
            ) : (
              <Empty description="没有符合当前筛选条件的渠道" />
            )}
          </Spin>
        )}

        {total > PAGE_SIZE ? (
          <Pagination
            current={page}
            onChange={setPage}
            pageSize={PAGE_SIZE}
            showSizeChanger={false}
            showTotal={(value) => `共 ${value} 个渠道`}
            total={total}
          />
        ) : null}
      </Card>

      <Typography.Text type="secondary">
        <ClockCircleOutlined /> 渠道采购状态和履约指标由平台定时同步。
      </Typography.Text>
    </Space>
  );
}
