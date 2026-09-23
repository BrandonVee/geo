import {
  BoundedJsonResponseError,
  discardResponseBody,
  isHttpOrigin,
  readBoundedJsonResponse,
} from "@geo/core";
import { z } from "zod";

export type FrogMediaType = "website" | "wemedia";
export type FrogPublicationErrorKind =
  | "not_configured"
  | "timeout"
  | "upstream"
  | "business"
  | "invalid_response";

export class FrogPublicationError extends Error {
  constructor(
    public readonly kind: FrogPublicationErrorKind,
    public readonly operation: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

const scalarString = z
  .union([
    z.string().trim().min(1).max(128),
    z.number().int().positive().safe(),
  ])
  .transform(String);
const priceString = z
  .union([z.string().trim().min(1).max(128), z.number().finite().nonnegative()])
  .transform(String);
const nullableScalarString = z
  .union([z.string(), z.number(), z.null()])
  .transform((value) => (value === null ? null : String(value)));
const integerLike = z
  .union([z.number().int(), z.string().regex(/^\d+$/)])
  .transform(Number);

const mediaResourceSchema = z.object({
  resource_id: scalarString,
  title: z.string(),
  remarks: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
  case_link: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
  field_1: nullableScalarString.optional(),
  field_2: nullableScalarString.optional(),
  field_3: nullableScalarString.optional(),
  field_4: nullableScalarString.optional(),
  field_5: nullableScalarString.optional(),
  field_6: nullableScalarString.optional(),
  field_7: nullableScalarString.optional(),
  field_8: nullableScalarString.optional(),
  field_9: nullableScalarString.optional(),
  pc_weigh: nullableScalarString.optional(),
  wap_weigh: nullableScalarString.optional(),
  publish_rate: nullableScalarString.optional(),
  publish_time: integerLike.optional(),
  status: integerLike,
  price: priceString,
});

const mediaFieldSchema = z.object({
  field_id: scalarString,
  field_type: z.string().regex(/^field_[1-9]\d*$/),
  field_title: z.string().trim().min(1).max(160),
  rsort: integerLike,
});

const submitResultSchema = z.object({ order_nid: scalarString });
const balanceSchema = z.object({
  power_count: integerLike,
  money: priceString,
});
const orderInfoSchema = z.object({
  resource_id: scalarString,
  order_nid: scalarString,
  status: integerLike,
  price: priceString.optional(),
  is_refund: integerLike.optional(),
  title: z.string().optional(),
  remark: z.string().nullish(),
  rejection_info: z.string().nullish(),
  refund_info: z.string().nullish(),
  rewrite_info: z.string().nullish(),
  order_url: z
    .union([
      z.literal(""),
      z
        .url()
        .max(2000)
        .refine((value) =>
          ["http:", "https:"].includes(new URL(value).protocol),
        ),
    ])
    .nullish(),
});

const envelopeSchema = z.object({
  code: z.union([z.number(), z.string().regex(/^-?\d+$/)]).transform(Number),
  msg: z.string().nullish(),
  data: z.unknown(),
});

export type FrogMediaResource = z.infer<typeof mediaResourceSchema>;
export type FrogMediaField = z.infer<typeof mediaFieldSchema>;
export type FrogOrderInfo = z.infer<typeof orderInfoSchema>;
export type FrogAccountBalance = z.infer<typeof balanceSchema>;

const operationPrefix = (mediaType: FrogMediaType) =>
  mediaType === "website" ? "/api/media" : "/api/zi_media_api";

export function frogPriceToCents(price: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(price))
    throw new FrogPublicationError(
      "invalid_response",
      "media_list",
      "聚合发布价格格式无效",
    );
  const [yuan, fraction = ""] = price.split(".");
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 1_000_000_000)
    throw new FrogPublicationError(
      "invalid_response",
      "media_list",
      "聚合发布价格超出范围",
    );
  return cents;
}

export class FrogPublicationClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    apiKey = process.env.FROG_PUBLICATION_API_KEY ?? "",
    baseUrl = process.env.FROG_PUBLICATION_BASE_URL ??
      "http://8.138.187.158:8082",
  ) {
    if (!isHttpOrigin(baseUrl))
      throw new Error("FROG_PUBLICATION_BASE_URL_INVALID");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  get configured() {
    return this.apiKey.trim().length > 0;
  }

  private async post<T>(
    operation: string,
    fields: Record<string, string | number | string[] | undefined>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    if (!this.configured)
      throw new FrogPublicationError(
        "not_configured",
        operation,
        "聚合发布 API Key 尚未配置",
      );
    const body = new FormData();
    body.set("api_key", this.apiKey);
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) body.append(key, item);
      } else body.set(key, String(value));
    }
    let responseStatus: number | undefined;
    try {
      const response = await fetch(new URL(operation, this.baseUrl), {
        method: "POST",
        redirect: "error",
        body,
        signal: AbortSignal.timeout(15_000),
      });
      responseStatus = response.status;
      if (!response.ok) {
        await discardResponseBody(response);
        throw new FrogPublicationError(
          "upstream",
          operation,
          `聚合发布上游返回 HTTP ${response.status}`,
          response.status,
        );
      }
      const envelope = envelopeSchema.safeParse(
        await readBoundedJsonResponse(response),
      );
      if (!envelope.success)
        throw new FrogPublicationError(
          "invalid_response",
          operation,
          "聚合发布上游响应格式无效",
          response.status,
        );
      if (envelope.data.code !== 1)
        throw new FrogPublicationError(
          "business",
          operation,
          "聚合发布上游拒绝请求",
          response.status,
        );
      const parsed = schema.safeParse(envelope.data.data);
      if (!parsed.success)
        throw new FrogPublicationError(
          "invalid_response",
          operation,
          "聚合发布业务数据格式无效",
          response.status,
        );
      return parsed.data;
    } catch (error) {
      if (error instanceof FrogPublicationError) throw error;
      if (error instanceof BoundedJsonResponseError)
        throw new FrogPublicationError(
          "invalid_response",
          operation,
          "聚合发布上游响应格式无效",
          responseStatus,
        );
      throw new FrogPublicationError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? "timeout"
          : "upstream",
        operation,
        error instanceof DOMException && error.name === "TimeoutError"
          ? "聚合发布上游请求超时"
          : "聚合发布上游请求失败",
      );
    }
  }

  listMedia(mediaType: FrogMediaType, page = 1, pageSize = 100) {
    return this.post(
      `${operationPrefix(mediaType)}/media_list`,
      { page, page_size: pageSize },
      z.array(mediaResourceSchema),
    );
  }

  listMediaFields(mediaType: FrogMediaType, fieldType?: `field_${number}`) {
    return this.post(
      `${operationPrefix(mediaType)}/get_field`,
      { media_type: mediaType, field_type: fieldType },
      z.array(mediaFieldSchema),
    );
  }

  getBalance() {
    return this.post("/api/geo/get_balance", {}, balanceSchema);
  }

  submit(
    mediaType: FrogMediaType,
    input: {
      resourceId: string;
      title: string;
      content: string;
      remark?: string;
      thirdId: string;
    },
  ) {
    return this.post(
      `${operationPrefix(mediaType)}/send`,
      {
        resource_id: input.resourceId,
        title: input.title,
        content: input.content,
        remark: input.remark,
        third_id: input.thirdId,
      },
      submitResultSchema,
    );
  }

  async orderInfo(mediaType: FrogMediaType, orderIds: string[]) {
    const result = await this.post(
      `${operationPrefix(mediaType)}/order_info`,
      { "order_nids[]": orderIds },
      z.union([z.array(orderInfoSchema), orderInfoSchema]),
    );
    return Array.isArray(result) ? result : [result];
  }

  cancel(mediaType: FrogMediaType, orderId: string) {
    return this.post(
      `${operationPrefix(mediaType)}/cancel_order`,
      { order_nid: orderId },
      z.null(),
    );
  }

  appeal(
    mediaType: FrogMediaType,
    input: { orderId: string; reason: 1 | 2 | 3 | 4; detail?: string },
  ) {
    return this.post(
      `${operationPrefix(mediaType)}/rejection`,
      {
        order_nid: input.orderId,
        title_id: input.reason,
        info: input.detail,
      },
      z.null(),
    );
  }
}
