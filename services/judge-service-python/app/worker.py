import json
import logging
import signal
import time
from typing import Any, Dict, Optional

import pika
import pika.exceptions

from . import amqp, redis
from .config import settings
from .db import close_db_pool, init_db_pool
from .engine import create_engine
from .logging import setup_logging
from .repository import (
    SubmissionMessage,
    RunMessage,
    load_submission_user,
    mark_submission_error,
    save_verdict,
    save_run_result,
    mark_run_error,
)

setup_logging()
logger = logging.getLogger(__name__)

shutdown_flag = False


def signal_handler(signum: int, frame: object) -> None:
    global shutdown_flag
    logger.info(f"Received signal {signum}, shutting down...")
    shutdown_flag = True


def process_submission(message: SubmissionMessage) -> None:
    actor = load_submission_user(message.submission_id)
    if actor is None:
        logger.error(f"Submission {message.submission_id} not found")
        return

    engine = create_engine()
    verdict = engine.judge(message.problem_id, message.language, message.source_code)
    old_status = save_verdict(message.submission_id, verdict, actor)

    # S2 修复：基于 (old_status, new_status) 状态机调整 AC 计数，保证幂等。
    # - 非 AC → AC：increment
    # - AC → 非 AC：decrement（rejudge 后判题失败、worker 异常等场景）
    # - AC → AC / 非 AC → 非 AC：不变
    if old_status is None:
        return
    if verdict.status == "AC" and old_status != "AC":
        redis.increment_ac(actor[0])
    elif verdict.status != "AC" and old_status == "AC":
        redis.decrement_ac(actor[0])


def process_run(message: RunMessage) -> None:
    engine = create_engine()
    result = engine.run_code(message.language, message.source_code, message.stdin)
    if result.status == "OK":
        save_run_result(message.run_id, "OK", result.output or "", None, result.runtime_ms)
    else:
        save_run_result(
            message.run_id,
            "RE" if result.status in {"CE", "RE"} else result.status,
            None,
            result.error_message or result.output or "",
            result.runtime_ms,
        )


def on_message(ch: pika.channel.Channel, method: pika.spec.Basic.Deliver, _properties: pika.spec.BasicProperties, body: bytes) -> None:
    run_id: Optional[int] = None
    submission_id: Optional[int] = None
    try:
        raw = json.loads(body.decode("utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("message payload must be an object")

        if raw.get("mode") == "run":
            run_id = int(raw.get("run_id") or 0)
            message = RunMessage.model_validate(raw)
            process_run(message)
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        submission_id = int(raw.get("submission_id") or 0)
        message = SubmissionMessage.model_validate(raw)
        process_submission(message)
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as exc:
        logger.error(f"Worker process failed: {exc}")
        if run_id:
            try:
                mark_run_error(run_id, str(exc))
            except Exception as db_err:
                logger.error(f"Failed to update run {run_id} status: {db_err}")
        elif submission_id:
            try:
                old_status = mark_submission_error(submission_id, str(exc))
                # S2 修复：worker 异常导致状态从 AC 转 RE 时，回退 AC 计数
                if old_status == "AC":
                    actor = load_submission_user(submission_id)
                    if actor:
                        redis.decrement_ac(actor[0])
            except Exception as db_err:
                logger.error(f"Failed to update submission {submission_id} status: {db_err}")
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)


def run_worker() -> None:
    global shutdown_flag
    settings.require()
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    init_db_pool()

    while not shutdown_flag:
        try:
            connection = amqp.connect_mq()
            channel = connection.channel()
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(queue=settings.judge_queue, on_message_callback=on_message)

            logger.info(f"Judge worker listening on queue={settings.judge_queue}")

            while not shutdown_flag:
                try:
                    connection.process_data_events(time_limit=1)
                except pika.exceptions.AMQPConnectionError:
                    break
                except Exception as exc:
                    logger.error(f"Worker error during processing: {exc}")
                    break

            try:
                channel.stop_consuming()
                connection.close()
            except Exception:
                pass
        except pika.exceptions.AMQPConnectionError as exc:
            if not shutdown_flag:
                logger.error(f"RabbitMQ connection lost: {exc}. Reconnecting in {settings.reconnect_delay_seconds} seconds...")
                time.sleep(settings.reconnect_delay_seconds)
        except Exception as exc:
            if not shutdown_flag:
                logger.error(f"Worker error: {exc}. Restarting in {settings.reconnect_delay_seconds} seconds...")
                time.sleep(settings.reconnect_delay_seconds)

    logger.info("Worker shutting down gracefully")
    close_db_pool()
    redis.close_redis()


if __name__ == "__main__":
    run_worker()
