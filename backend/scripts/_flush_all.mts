import Redis from "ioredis";
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const keys = await redis.keys("search:trips:*");
if (keys.length > 0) {
  await redis.del(...keys);
  console.log("Cache vidé :", keys.length, "clé(s)");
} else {
  console.log("Cache déjà vide");
}
await redis.quit();