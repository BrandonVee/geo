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
  providerMetadata?: {
    pcWeight?: string | null;
    wapWeight?: string | null;
    publishRate?: string | null;
    publishTimeSeconds?: number | null;
    fields?: Record<string, string | null>;
    fieldTitles?: Record<string, string[]>;
  } | null;
};

export type PublicationChannelQuery = {
  page: number;
  pageSize: number;
  q?: string;
  mediaType?: "website" | "wemedia" | "manual";
  maxPriceAmount?: number;
  sort: "recommended" | "priceAsc" | "rateDesc" | "speedAsc";
};
