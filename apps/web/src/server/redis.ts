import { createClient, type RedisClientType } from "redis";
import { getServerEnv } from "./env";

type RedisState = {
  client?: RedisClientType;
  connecting?: Promise<RedisClientType>;
};

const redisState = globalThis as typeof globalThis & {
  __answerbitGeoRedis?: RedisState;
};
const state = (redisState.__answerbitGeoRedis ??= {});
const keyPrefix = "answerbit-geo:auth:";

const namespaced = (key: string) => `${keyPrefix}${key}`;

export async function getRedisClient() {
  if (state.client?.isOpen) return state.client;
  if (state.connecting) return state.connecting;

  const runtimeEnv = getServerEnv();
  const client = createClient({
    url: runtimeEnv.REDIS_URL,
    socket: {
      connectTimeout: runtimeEnv.REDIS_CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) =>
        retries >= 3 ? false : Math.min(100 * 2 ** retries, 3_000),
    },
  });
  client.on("error", (error) => {
    console.error(
      JSON.stringify({
        event: "redis.client-error",
        errorCode:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "REDIS_ERROR",
      }),
    );
  });

  state.client = client as RedisClientType;
  state.connecting = client
    .connect()
    .then(() => client as RedisClientType)
    .catch((error) => {
      if (state.client === client) state.client = undefined;
      throw error;
    })
    .finally(() => {
      state.connecting = undefined;
    });
  return state.connecting;
}

export const redisSecondaryStorage = {
  async get(key: string) {
    return (await getRedisClient()).get(namespaced(key));
  },
  async getAndDelete(key: string) {
    return (await getRedisClient()).getDel(namespaced(key));
  },
  async increment(key: string, ttl: number) {
    const result = await (
      await getRedisClient()
    ).eval(
      "local current = redis.call('INCR', KEYS[1]); if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return current",
      {
        keys: [namespaced(key)],
        arguments: [String(Math.max(1, Math.floor(ttl)))],
      },
    );
    return Number(result);
  },
  async set(key: string, value: string, ttl?: number) {
    const client = await getRedisClient();
    if (ttl && ttl > 0)
      return client.set(namespaced(key), value, {
        expiration: { type: "EX", value: Math.max(1, Math.floor(ttl)) },
      });
    return client.set(namespaced(key), value);
  },
  async delete(key: string) {
    await (await getRedisClient()).del(namespaced(key));
  },
};

export async function pingRedis() {
  return (await getRedisClient()).ping();
}
