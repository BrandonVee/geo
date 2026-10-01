import { z } from "zod";
import {
  contentDocumentStatusSchema,
  contentDocumentSourceSchema,
} from "@geo/contracts";
const querySchema = z.object({
  q: z.string().trim().max(200).default(""),
  folder: z
    .union([z.enum(["all", "unfiled"]), z.string().uuid()])
    .default("all"),
  status: contentDocumentStatusSchema.or(z.literal("active")).default("active"),
  source: contentDocumentSourceSchema.or(z.literal("all")).default("all"),
  page: z.coerce.number().int().min(1).max(5001).default(1),
});
export type DocumentLibraryQuery = z.infer<typeof querySchema>;
type Scope = { organizationId: string; teamBindingId: string; brandId: string };
const keys = {
  q: "libraryQ",
  folder: "libraryFolder",
  status: "libraryStatus",
  source: "librarySource",
  page: "libraryPage",
} as const;
const markers = {
  organizationId: "libraryOrganizationId",
  teamBindingId: "libraryTeamBindingId",
  brandId: "libraryBrandId",
} as const;
export const libraryResetQueryKeys = [
  ...Object.values(keys),
  ...Object.values(markers),
];
const defaults = () => querySchema.parse({});
export function readDocumentLibraryQuery(
  params: Pick<URLSearchParams, "get">,
  scope: Scope,
) {
  const matches = Object.entries(markers).every(
    ([field, marker]) => params.get(marker) === scope[field as keyof Scope],
  );
  const raw: Record<string, unknown> = {};
  if (matches)
    for (const [field, key] of Object.entries(keys)) {
      const value = params.get(key);
      if (value !== null) raw[field] = value;
    }
  const parsed = querySchema.safeParse(raw);
  return {
    query: parsed.success ? parsed.data : defaults(),
    invalid: !parsed.success,
  };
}
export function writeDocumentLibraryQuery(
  params: URLSearchParams,
  scope: Scope,
  query: DocumentLibraryQuery,
  patch: Partial<DocumentLibraryQuery>,
) {
  const next = querySchema.parse({ ...query, page: 1, ...patch });
  const result = new URLSearchParams(params);
  for (const [field, marker] of Object.entries(markers))
    result.set(marker, scope[field as keyof Scope]);
  const base = defaults();
  for (const [field, key] of Object.entries(keys)) {
    const typedField = field as keyof DocumentLibraryQuery;
    if (next[typedField] !== base[typedField])
      result.set(key, String(next[typedField]));
    else result.delete(key);
  }
  return result;
}
