import { meteringPeriodQuerySchema } from "@geo/contracts";
import { createMeteringGetRoute } from "@/server/http/metering-route";
import { meteringService } from "@/server/services/metering";
export const GET = createMeteringGetRoute(
  meteringPeriodQuerySchema,
  meteringService.creditTrends,
);
