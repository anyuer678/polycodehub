import { createClient, RedisClientType } from 'redis';
import { config } from '../config';

const retryStrategy = (times: number) => {
  if (times > 10) {
    console.error('redis max retry attempts reached');
    return new Error('redis max retry attempts reached');
  }
  return Math.min(times * 100, 3000);
};

export const redis: RedisClientType = createClient({
  url: config.redisUrl,
  socket: { reconnectStrategy: retryStrategy }
});

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;

redis.on('error', (err) => {
  console.error('redis error', err);
});

redis.on('reconnecting', () => {
  console.log('redis reconnecting...');
});

export async function connectRedis() {
  if (shuttingDown) return;
  try {
    await redis.connect();
    console.log('redis connected');
  } catch (err) {
    console.error('redis connect failed, will retry...', err);
    if (!shuttingDown) {
      retryTimer = setTimeout(() => connectRedis(), 5000);
    }
  }
}

export async function closeRedis(): Promise<void> {
  shuttingDown = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  try {
    await redis.quit();
  } catch {
    // ignore
  }
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}
