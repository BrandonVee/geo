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
  field1?: string;
  field2?: string;
  field3?: string;
  field4?: string;
  field5?: string;
  field6?: string;
  field7?: string;
  field8?: string;
  field9?: string;
  sort: "recommended" | "priceAsc" | "priceDesc" | "rateDesc" | "speedAsc";
};
