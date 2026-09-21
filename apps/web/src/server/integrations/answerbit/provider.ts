export type AnswerBitBrand = { id: string; name: string };
export type DashboardMetrics = {
  mentionRate: number;
  averageRank: number;
  exposureScore: number;
};
export interface AnswerBitProvider {
  testConnection(): Promise<{ ok: boolean; message?: string }>;
  listBrands(teamId: string): Promise<AnswerBitBrand[]>;
  getDashboard(input: {
    teamId: string;
    brandId: string;
    startDate?: string;
    endDate?: string;
  }): Promise<DashboardMetrics>;
  execute(input: {
    operation: string;
    payload: unknown;
    idempotencyKey: string;
  }): Promise<{ data: unknown }>;
}
