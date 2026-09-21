import {
  frogPriceToCents,
  type FrogMediaType,
  type FrogPublicationClient,
} from "./client";

export type FrogPublicationChannel = {
  providerResourceId: string;
  providerMediaType: FrogMediaType;
  name: string;
  category: string;
  priceAmount: number;
  status: "active" | "inactive";
  remarks: string;
  caseLink?: string;
  providerMetadata: Record<string, unknown>;
};

async function listCatalogue(
  client: FrogPublicationClient,
  mediaType: FrogMediaType,
) {
  const all = [];
  for (let page = 1; page <= 100; page += 1) {
    const rows = await client.listMedia(mediaType, page, 100);
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return all;
}

async function listFieldTitles(
  client: FrogPublicationClient,
  mediaType: FrogMediaType,
  onFieldError?: (mediaType: FrogMediaType, error: unknown) => void,
) {
  try {
    const fields = await client.listMediaFields(mediaType);
    return new Map(fields.map((field) => [field.field_id, field.field_title]));
  } catch (error) {
    onFieldError?.(mediaType, error);
    return new Map<string, string>();
  }
}

function resourceFields(
  row: Awaited<ReturnType<FrogPublicationClient["listMedia"]>>[number],
  titles: Map<string, string>,
) {
  const fields = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => {
      const key = `field_${index + 1}` as keyof typeof row;
      return [key, row[key]];
    }),
  );
  const fieldTitles = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === "string"
        ? value
            .split(",")
            .map((id) => titles.get(id.trim()))
            .filter((title): title is string => Boolean(title))
        : [],
    ]),
  );
  return { fields, fieldTitles };
}

export async function loadFrogPublicationChannels(
  client: FrogPublicationClient,
  options?: {
    onFieldError?: (mediaType: FrogMediaType, error: unknown) => void;
  },
): Promise<FrogPublicationChannel[]> {
  const mediaTypes: FrogMediaType[] = ["website", "wemedia"];
  const resources = await Promise.all(
    mediaTypes.map(async (mediaType) => {
      const [rows, fieldTitles] = await Promise.all([
        listCatalogue(client, mediaType),
        listFieldTitles(client, mediaType, options?.onFieldError),
      ]);
      return { mediaType, rows, fieldTitles };
    }),
  );
  return resources.flatMap(({ mediaType, rows, fieldTitles }) =>
    rows.map((row) => {
      const metadataFields = resourceFields(row, fieldTitles);
      return {
        providerResourceId: String(row.resource_id),
        providerMediaType: mediaType,
        name: row.title,
        category: mediaType === "website" ? "网站媒体" : "自媒体",
        priceAmount: frogPriceToCents(row.price),
        status: row.status === 1 ? "active" : "inactive",
        remarks: row.remarks,
        caseLink: row.case_link || undefined,
        providerMetadata: {
          pcWeight: row.pc_weigh,
          wapWeight: row.wap_weigh,
          publishRate: row.publish_rate,
          publishTimeSeconds: row.publish_time,
          ...metadataFields,
        },
      };
    }),
  );
}
