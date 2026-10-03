import Redis from "ioredis";
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const keys = await redis.keys("search:trips:*");
console.log("Clés cache:", keys.length, keys);
for (const k of keys) {
  const v = await redis.get(k);
  console.log(k, "->", v?.slice(0, 100));
}
await redis.quit();