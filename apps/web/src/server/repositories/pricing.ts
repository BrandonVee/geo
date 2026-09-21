import {
  getUserPricingTier,
  listPricingTierRules,
  setPricingTierRule,
} from "@geo/db";

export const pricingRepository = {
  listRules: listPricingTierRules,
  setRule: setPricingTierRule,
  userTier: getUserPricingTier,
};
