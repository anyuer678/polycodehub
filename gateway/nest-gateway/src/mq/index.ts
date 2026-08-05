import amqp, { Channel, Connection } from 'amqplib';
import { config } from '../config';

let mqConnection: Connection | null = null;
let mqChannel: Channel | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;

// 死信队列配置：与 Python worker amqp.py 保持一致。
// 注意：已有 queue 添加 x-dead-letter-exchange 前需先删除旧队列，否则 PRECONDITION_FAILED。
const DLX_EXCHANGE = 'judge.dlx';
const DLQ_QUEUE = 'judge.dlq';
const DLQ_ROUTING_KEY = 'judge.dead';

export function getMqChannel(): Channel | null {
  return mqChannel;
}

export async function initMq(): Promise<void> {
  if (shuttingDown) return;
  try {
    const conn = await amqp.connect(config.amqpUrl);
    mqConnection = conn as any;
    mqChannel = await conn.createChannel();
    // 声明死信交换机与死信队列
    await mqChannel.assertExchange(DLX_EXCHANGE, 'direct', { durable: true });
    await mqChannel.assertQueue(DLQ_QUEUE, { durable: true });
    await mqChannel.bindQueue(DLQ_QUEUE, DLX_EXCHANGE, DLQ_ROUTING_KEY);
    // 声明主队列并绑定死信交换机
    await mqChannel.assertQueue(config.judgeQueue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DLX_EXCHANGE,
        'x-dead-letter-routing-key': DLQ_ROUTING_KEY
      }
    });
    
    conn.on('error', (err) => {
      console.error('rabbitmq connection error:', err);
      mqChannel = null;
    });
    
    conn.on('close', () => {
      console.error('rabbitmq connection closed');
      mqChannel = null;
      if (!shuttingDown) {
        retryTimer = setTimeout(() => initMq(), 5000);
      }
    });
    
    console.log('rabbitmq connected');
  } catch (err) {
    console.error('rabbitmq init failed, will retry...', err);
    mqChannel = null;
    if (!shuttingDown) {
      retryTimer = setTimeout(() => initMq(), 5000);
    }
  }
}

export async function closeMq(): Promise<void> {
  shuttingDown = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  try {
    if (mqChannel) await mqChannel.close();
    if (mqConnection) await (mqConnection as any).close();
  } catch {
    // ignore
  }
}

export async function checkMqHealth(): Promise<boolean> {
  if (!mqChannel) return false;
  try {
    await mqChannel.checkQueue(config.judgeQueue);
    return true;
  } catch {
    return false;
  }
}
