"use client";

import {
  CheckCircleFilled,
  ClockCircleOutlined,
  GlobalOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import styles from "./publication-channel-picker.module.css";

type ProviderMetadata = {
  pcWeight?: string | null;
  wapWeight?: string | null;
  publishRate?: string | null;
  publishTimeSeconds?: number | null;
  fields?: Record<string, string | null>;
  fieldTitles?: Record<string, string[]>;
};

export type PublicationChannel = {
  id: string;
  name: string;
  category: string;
  priceAmount: number;
  currency: string;
  provider: string;
  providerMediaType: string | null;
  remarks: string;
  caseLink: string | null;
  providerMetadata?: ProviderMetadata | null;
};

type SortMode = "recommended" | "priceAsc" | "rateDesc" | "speedAsc";

const PAGE_SIZE = 12;
export type PublicationChannelQuery = {
  page: number;
  pageSize: number;
  q?: string;
  mediaType?: "website" | "wemedia" | "manual";
  maxPriceAmount?: number;
  sort: SortMode;
};
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

export function PublicationChannelPicker({
  channels,
  selectedChannel,
  total,
  loading,
  disabled,
  id,
  value,
  onChange,
  onSelect,
  onQuery,
}: {
  channels: PublicationChannel[];
  selectedChannel?: PublicationChannel;
  total: number;
  loading?: boolean;
  disabled?: boolean;
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSelect?: (channel: PublicationChannel) => void;
  onQuery: (query: PublicationChannelQuery) => void;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [mediaType, setMediaType] = useState("all");
  const [maxPriceYuan, setMaxPriceYuan] = useState<number | null>(null);
  const [sort, setSort] = useState<SortMode>("recommended");
  const [page, setPage] = useState(1);
  const selected =
    selectedChannel ?? channels.find((channel) => channel.id === value);

  useEffect(() => setPage(1), [keyword, maxPriceYuan, mediaType, sort]);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(
      () =>
        onQuery({
          page,
          pageSize: PAGE_SIZE,
          q: keyword.trim() || undefined,
          mediaType:
            mediaType === "all"
              ? undefined
              : (mediaType as "website" | "wemedia" | "manual"),
          maxPriceAmount:
            maxPriceYuan === null ? undefined : Math.round(maxPriceYuan * 100),
          sort,
        }),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [keyword, maxPriceYuan, mediaType, onQuery, open, page, sort]);

  return (
    <>
      <div className={styles.picker} id={id}>
        {selected ? (
          <div className={styles.selected}>
            <div className={styles.selectedHeader}>
              <div>
                <Space size={8} wrap>
                  <Tag
                    color={
                      selected.provider === "frog_media" ? "green" : "gold"
                    }
                  >
                    {selected.provider === "frog_media"
                      ? "小青蛙自动投稿"
                      : "人工渠道"}
                  </Tag>
                  <Typography.Text type="secondary">
                    {selected.category}
                  </Typography.Text>
                </Space>
                <Typography.Title level={4}>{selected.name}</Typography.Title>
              </div>
              <div className={styles.price}>
                <strong>{money(selected.priceAmount)}</strong>
                <span>本次发布</span>
              </div>
            </div>
            <ChannelMetrics channel={selected} />
            {channelTitles(selected).length ? (
              <Space className={styles.tags} size={[4, 6]} wrap>
                {channelTitles(selected)
                  .slice(0, 8)
                  .map((title) => (
                    <Tag bordered={false} key={title}>
                      {title}
                    </Tag>
                  ))}
              </Space>
            ) : null}
            {selected.remarks ? (
              <Typography.Paragraph
                className={styles.remark}
                ellipsis={{ rows: 2, expandable: true, symbol: "展开" }}
                type="secondary"
              >
                {selected.remarks}
              </Typography.Paragraph>
            ) : null}
            <Space wrap>
              <Button disabled={disabled} onClick={() => setOpen(true)}>
                更换渠道
              </Button>
              {selected.caseLink ? (
                <Button
                  href={selected.caseLink}
                  rel="noreferrer"
                  target="_blank"
                  type="link"
                >
                  查看发布案例
                </Button>
              ) : null}
            </Space>
          </div>
        ) : (
          <Button
            block
            className={styles.emptyPicker}
            disabled={disabled}
            onClick={() => setOpen(true)}
            type="text"
          >
            <span className={styles.emptyIcon}>
              <GlobalOutlined />
            </span>
            <span>
              <strong>从 {total.toLocaleString()} 个媒体资源中选择</strong>
              <small>按媒体类型、行业、价格、出稿率与发布速度筛选</small>
            </span>
            <b>浏览渠道</b>
          </Button>
        )}
      </div>

      <Modal
        centered
        destroyOnHidden
        footer={null}
        onCancel={() => setOpen(false)}
        open={open}
        title={
          <div className={styles.modalTitle}>
            <span>媒体渠道库</span>
            <small>已同步小青蛙媒体资源，展示当前账户等级售价</small>
          </div>
        }
        width={1120}
      >
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
            suffix="元以内"
            aria-label="最高发布价格"
            min={0}
            onChange={(next) => setMaxPriceYuan(next)}
            placeholder="不限预算"
            precision={2}
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
            采购状态定时同步；售价按您的客户等级与渠道规则计算
          </Typography.Text>
        </div>

        <Spin spinning={Boolean(loading)}>
          {channels.length ? (
            <div className={styles.grid}>
              {channels.map((channel) => {
                const active = channel.id === value;
                return (
                  <Button
                    aria-pressed={active}
                    className={`${styles.channelCard} ${active ? styles.active : ""}`}
                    key={channel.id}
                    onClick={() => {
                      onSelect?.(channel);
                      onChange?.(channel.id);
                      setOpen(false);
                    }}
                    type="text"
                  >
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
                      {active ? <CheckCircleFilled /> : null}
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
                    <div className={styles.chooseLine}>
                      <ClockCircleOutlined />
                      <span>{active ? "当前已选择" : "选择此渠道"}</span>
                    </div>
                  </Button>
                );
              })}
            </div>
          ) : (
            <Empty description="没有符合当前筛选条件的渠道" />
          )}
        </Spin>

        {total > PAGE_SIZE ? (
          <Pagination
            align="center"
            current={page}
            hideOnSinglePage
            onChange={setPage}
            pageSize={PAGE_SIZE}
            showSizeChanger={false}
            total={total}
          />
        ) : null}
      </Modal>
    </>
  );
}
