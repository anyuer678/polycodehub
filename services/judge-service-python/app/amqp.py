import logging
from typing import Optional

import pika

from .config import settings

logger = logging.getLogger(__name__)

# 死信队列配置：判题任务 nack(requeue=False) 后进入死信队列，便于人工排查或重试。
# 注意：RabbitMQ 中已有 queue 在添加 x-dead-letter-exchange 参数前必须先删除，
# 否则 PRECONDITION_FAILED。首次部署时请先删除旧 judge.submissions 队列。
DLX_EXCHANGE = "judge.dlx"
DLQ_QUEUE = "judge.dlq"
DLQ_ROUTING_KEY = "judge.dead"


def connect_mq() -> pika.BlockingConnection:
    params = pika.URLParameters(settings.amqp_url)
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    # 声明死信交换机与死信队列
    channel.exchange_declare(exchange=DLX_EXCHANGE, exchange_type="direct", durable=True)
    channel.queue_declare(queue=DLQ_QUEUE, durable=True)
    channel.queue_bind(queue=DLQ_QUEUE, exchange=DLX_EXCHANGE, routing_key=DLQ_ROUTING_KEY)
    # 声明主队列并绑定死信交换机
    channel.queue_declare(
        queue=settings.judge_queue,
        durable=True,
        arguments={
            "x-dead-letter-exchange": DLX_EXCHANGE,
            "x-dead-letter-routing-key": DLQ_ROUTING_KEY,
        },
    )
    logger.info("RabbitMQ connection established (DLX=%s, DLQ=%s)", DLX_EXCHANGE, DLQ_QUEUE)
    return connection


def close_mq(connection: Optional[pika.BlockingConnection]) -> None:
    if connection is not None and connection.is_open:
        try:
            connection.close()
        except Exception as exc:
            logger.error(f"Failed to close RabbitMQ connection: {exc}")
