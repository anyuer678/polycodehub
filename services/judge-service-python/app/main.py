import logging
from contextlib import asynccontextmanager
from typing import Optional

import pika
from fastapi import FastAPI

from . import amqp
from .config import settings
from .logging import setup_logging

setup_logging()
logger = logging.getLogger(__name__)

mq_connection: Optional[pika.BlockingConnection] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global mq_connection
    try:
        mq_connection = amqp.connect_mq()
    except Exception as exc:
        logger.error(f"Failed to connect to RabbitMQ at startup: {exc}")
        mq_connection = None
    yield
    amqp.close_mq(mq_connection)


app = FastAPI(title="judge-service-python", lifespan=lifespan)


@app.get("/health")
def health():
    mq_ok = bool(mq_connection is not None and mq_connection.is_open)
    return {
        "service": "judge",
        "status": "ok",
        "rabbitmq": "connected" if mq_ok else "disconnected",
    }
