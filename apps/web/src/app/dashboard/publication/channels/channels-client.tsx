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
type ChannelFieldKey =
  | "field1"
  | "field2"
  | "field3"
  | "field4"
  | "field5"
  | "field6"
  | "field7"
  | "field8"
  | "field9";
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
const COLLAPSED_OPTION_COUNT = 10;
const CHANNEL_FILTER_GROUPS: Array<{
  key: ChannelFieldKey;
  label: string;
  options: string[];
}> = [
  {
    key: "field1",
    label: "行业领域",
    options: [
      "IT科技",
      "游戏网站",
      "财经商业",
      "汽车网站",
      "娱乐休闲",
      "新闻资讯",
      "健康医疗",
      "房产家居",
      "亲子母婴",
      "教育培训",
      "食品餐饮",
      "酒店旅游",
      "女性时尚",
      "生活消费",
      "公益",
      "体育运动",
      "工业贸易",
      "文化艺术",
      "套餐系列",
      "最新秒杀",
      "十元专区",
      "区块链",
      "其他",
    ],
  },
  {
    key: "field2",
    label: "综合门户",
    options: [
      "腾讯网",
      "新浪网",
      "网易网",
      "搜狐网",
      "凤凰网",
      "人民网",
      "央视网",
      "中国广播网",
      "中国新闻网",
      "新华网",
      "中国日报网",
      "光明网",
      "中国青年网",
      "环球网",
      "千龙网",
      "北青网",
      "中国经济网",
      "国际在线",
      "和讯网",
      "中国网",
      "中华网",
      "东方网",
      "大众网",
      "慧聪网",
      "垂直媒体",
      "其他门户",
      "人民日报客户端",
      "zaker号",
      "官方百家号",
      "荆楚网（湖北日报）",
    ],
  },
  {
    key: "field3",
    label: "所在地区",
    options: [
      "综合全国",
      "北京",
      "上海",
      "重庆",
      "天津",
      "海南",
      "广东",
      "广西",
      "湖南",
      "湖北",
      "福建",
      "江西",
      "浙江",
      "安徽",
      "江苏",
      "河南",
      "河北",
      "山东",
      "山西",
      "贵州",
      "四川",
      "青海",
      "西藏",
      "辽宁",
      "吉林",
      "陕西",
      "甘肃",
      "宁夏",
      "黑龙江",
      "内蒙古",
      "云南",
      "新疆",
      "港澳台",
    ],
  },
  {
    key: "field4",
    label: "入口级别",
    options: ["没有入口", "首页入口", "频道入口", "上级入口"],
  },
  {
    key: "field5",
    label: "收录情况",
    options: ["不包网页收录", "包网页收录", "不包资讯收录", "包资讯收录"],
  },
  {
    key: "field6",
    label: "链接类型",
    options: ["不可带网址", "可带网址"],
  },
  {
    key: "field7",
    label: "发稿速度",
    options: ["1小时", "2小时", "12小时", "当日", "次日", "48小时以上"],
  },
  {
    key: "field8",
    label: "特殊行业",
    options: ["金融", "微商", "留学", "医疗", "加盟"],
  },
  {
    key: "field9",
    label: "高级选项",
    options: [
      "周末可发",
      "节日可发",
      "晚上可发",
      "文字链/焦点图",
      "白名单来源",
      "可带视频",
      "移动端媒体",
      "时效3月以上",
      "可发GEO排名",
    ],
  },
];
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
  const [fieldFilters, setFieldFilters] = useState<
    Partial<Record<ChannelFieldKey, string>>
  >({});
  const [expandedFields, setExpandedFields] = useState<Set<ChannelFieldKey>>(
    new Set(),
  );
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
      for (const [key, value] of Object.entries(fieldFilters)) {
        if (value) params.set(key, value);
      }
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
    [fieldFilters, keyword, maxPriceYuan, mediaType, page, sort],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  useEffect(
    () => setPage(1),
    [fieldFilters, keyword, maxPriceYuan, mediaType, sort],
  );

  const setFieldFilter = (key: ChannelFieldKey, value?: string) =>
    setFieldFilters((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });

  const toggleFieldExpanded = (key: ChannelFieldKey) =>
    setExpandedFields((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
              { label: "价格不限", value: "recommended" },
              { label: "价格由低到高", value: "priceAsc" },
              { label: "价格由高到低", value: "priceDesc" },
              { label: "出稿率从高到低", value: "rateDesc" },
              { label: "平均出稿最快", value: "speedAsc" },
            ]}
            value={sort}
          />
        </div>

        <div aria-label="媒体属性筛选" className={styles.filterMatrix}>
          {CHANNEL_FILTER_GROUPS.map((group) => {
            const expanded = expandedFields.has(group.key);
            const visibleOptions = expanded
              ? group.options
              : group.options.slice(0, COLLAPSED_OPTION_COUNT);
            const selected = fieldFilters[group.key];
            return (
              <div className={styles.filterRow} key={group.key}>
                <strong>{group.label}</strong>
                <div className={styles.filterOptions}>
                  <button
                    aria-pressed={!selected}
                    className={!selected ? styles.filterActive : undefined}
                    onClick={() => setFieldFilter(group.key)}
                    type="button"
                  >
                    不限
                  </button>
                  {visibleOptions.map((option) => (
                    <button
                      aria-pressed={selected === option}
                      className={
                        selected === option ? styles.filterActive : undefined
                      }
                      key={option}
                      onClick={() => setFieldFilter(group.key, option)}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </div>
                {group.options.length > COLLAPSED_OPTION_COUNT ? (
                  <button
                    aria-expanded={expanded}
                    className={styles.expandButton}
                    onClick={() => toggleFieldExpanded(group.key)}
                    type="button"
                  >
                    {expanded ? "收起" : "展开"}
                  </button>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
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
