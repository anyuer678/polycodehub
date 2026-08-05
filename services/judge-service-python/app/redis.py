import calendar
import logging
import time
from typing import List, Optional

import redis

from .config import settings

logger = logging.getLogger(__name__)

_client: Optional[redis.Redis] = None


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def period_keys() -> List[str]:
    now = time.gmtime()
    weekly_key = time.strftime("leaderboard:weekly:%Y-%m-%d", time.gmtime(calendar.timegm(now) - (now.tm_wday * 86400)))
    monthly_key = time.strftime("leaderboard:monthly:%Y-%m", now)
    return ["leaderboard:ac", weekly_key, monthly_key]


def increment_ac(user_id: int) -> None:
    try:
        client = get_redis()
        for key in period_keys():
            client.zincrby(key, 1, str(user_id))
    except Exception as exc:
        logger.error(f"Failed to update leaderboard: {exc}")


def decrement_ac(user_id: int) -> None:
    """S2 修复：状态从 AC 转为非 AC（rejudge / 重判失败）时回退 AC 计数，保持排行榜一致。"""
    try:
        client = get_redis()
        for key in period_keys():
            client.zincrby(key, -1, str(user_id))
    except Exception as exc:
        logger.error(f"Failed to update leaderboard: {exc}")


def close_redis() -> None:
    global _client
    if _client is not None:
        try:
            _client.close()
        except Exception as exc:
            logger.error(f"Failed to close redis: {exc}")
        _client = None
