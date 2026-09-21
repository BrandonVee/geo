import { meteringScopeQuerySchema } from "@geo/contracts";
import { createMeteringGetRoute } from "@/server/http/metering-route";
import { meteringService } from "@/server/services/metering";
export const GET = createMeteringGetRoute(
  meteringScopeQuerySchema,
  meteringService.subscription,
);
