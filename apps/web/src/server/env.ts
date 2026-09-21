import { env, webEnvSchema } from "@geo/config";

let cached: ReturnType<typeof env> | undefined;

export const getServerEnv = () => (cached ??= env());

export const inspectServerEnv = () => webEnvSchema.safeParse(process.env);
