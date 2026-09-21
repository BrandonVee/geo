"use client";

import { RobotOutlined } from "@ant-design/icons";
import Image from "next/image";
import type { ReactNode } from "react";

type ModelDefinition = {
  aliases: string[];
  iconSrc: string;
  name: string;
};

const normalizeModelKey = (value: string) =>
  value.toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");

const modelDefinitions: ModelDefinition[] = [
  {
    aliases: ["deepseek", "深度求索"],
    iconSrc: "/model-icons/deepseek-color.svg",
    name: "DeepSeek 深度求索",
  },
  {
    aliases: ["doubao", "豆包"],
    iconSrc: "/model-icons/doubao-color.svg",
    name: "豆包",
  },
  {
    aliases: ["yuanbao", "tencentyuanbao", "hunyuan", "腾讯元宝", "元宝"],
    iconSrc: "/model-icons/hunyuan-color.svg",
    name: "腾讯元宝",
  },
  {
    aliases: [
      "qwen",
      "qwenai",
      "qianwen",
      "qianwenai",
      "aliqianwen",
      "aliyunqianwen",
      "alibabacloudqianwen",
      "tongyi",
      "tongyiqianwen",
      "通义千问",
      "阿里千问",
      "千问",
    ],
    iconSrc: "/model-icons/qwen-color.svg",
    name: "通义千问",
  },
  {
    aliases: ["wenxin", "ernie", "yiyan", "文心一言"],
    iconSrc: "/model-icons/wenxin-color.svg",
    name: "文心一言",
  },
  {
    aliases: [
      "kimi",
      "kimiai",
      "kimichat",
      "kimisearch",
      "kimi智能助手",
      "moonshot",
      "moonshotai",
      "月之暗面",
      "月之暗面kimi",
    ],
    iconSrc: "/model-icons/kimi-color.svg",
    name: "Kimi 智能助手",
  },
  {
    aliases: ["zhipu", "chatglm", "glm", "智谱", "清言"],
    iconSrc: "/model-icons/zhipu-color.svg",
    name: "智谱清言",
  },
  {
    aliases: ["spark", "xinghuo", "讯飞星火", "星火"],
    iconSrc: "/model-icons/spark-color.svg",
    name: "讯飞星火",
  },
  {
    aliases: ["metaso", "mita", "秘塔"],
    iconSrc: "/model-icons/metaso.png",
    name: "秘塔 AI 搜索",
  },
  {
    aliases: ["360", "360ai", "360zhinao", "360智脑"],
    iconSrc: "/model-icons/ai360-color.svg",
    name: "360 智脑",
  },
  {
    aliases: ["chatgpt", "openai", "gpt"],
    iconSrc: "/model-icons/openai.svg",
    name: "ChatGPT",
  },
  {
    aliases: ["gemini", "google"],
    iconSrc: "/model-icons/gemini-color.svg",
    name: "Gemini",
  },
  {
    aliases: ["claude", "anthropic"],
    iconSrc: "/model-icons/claude-color.svg",
    name: "Claude",
  },
  {
    aliases: ["perplexity"],
    iconSrc: "/model-icons/perplexity-color.svg",
    name: "Perplexity",
  },
  {
    aliases: ["tiangong", "天工"],
    iconSrc: "/model-icons/tiangong-color.svg",
    name: "天工 AI",
  },
];

export function resolveModelDisplay(modelId: string, upstreamLabel?: string) {
  const candidates = [modelId, upstreamLabel ?? ""]
    .map(normalizeModelKey)
    .filter(Boolean);
  const definition = modelDefinitions.find((item) =>
    item.aliases.some((alias) => {
      const normalizedAlias = normalizeModelKey(alias);
      return candidates.some(
        (candidate) =>
          candidate === normalizedAlias || candidate.includes(normalizedAlias),
      );
    }),
  );
  return (
    definition ?? {
      aliases: [],
      iconSrc: "",
      name: upstreamLabel || modelId || "未知模型",
    }
  );
}

export function findModelUpstreamLabel(
  platforms: Record<string, string>,
  modelId: string,
) {
  return Object.entries(platforms).find(
    ([, value]) => normalizeModelKey(value) === normalizeModelKey(modelId),
  )?.[0];
}

export function ModelLabel({
  modelId,
  upstreamLabel,
}: {
  modelId: string;
  upstreamLabel?: string;
}) {
  const model = resolveModelDisplay(modelId, upstreamLabel);
  return (
    <span className="model-label">
      <span aria-hidden="true" className="model-icon">
        {model.iconSrc ? (
          <Image alt="" height={18} src={model.iconSrc} width={18} />
        ) : (
          <RobotOutlined />
        )}
      </span>
      <span>{model.name}</span>
    </span>
  );
}

export function modelSelectOptions(platforms: Record<string, string>) {
  return Object.entries(platforms)
    .map(([upstreamLabel, modelId]) => {
      const model = resolveModelDisplay(modelId, upstreamLabel);
      return {
        label: (
          <ModelLabel modelId={modelId} upstreamLabel={upstreamLabel} />
        ) as ReactNode,
        searchText: `${model.name} ${upstreamLabel} ${modelId}`,
        value: modelId,
      };
    })
    .sort((left, right) =>
      left.searchText.localeCompare(right.searchText, "zh-CN"),
    );
}
