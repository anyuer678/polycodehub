import os
from dataclasses import dataclass, field
from typing import Dict


@dataclass(frozen=True)
class Settings:
    amqp_url: str = field(default_factory=lambda: os.getenv("AMQP_URL", "amqp://rabbitmq:5672"))
    judge_queue: str = field(default_factory=lambda: os.getenv("JUDGE_QUEUE", "judge.submissions"))

    db_host: str = field(default_factory=lambda: os.getenv("DB_HOST", "postgres"))
    db_port: int = field(default_factory=lambda: int(os.getenv("DB_PORT", "5432")))
    db_name: str = field(default_factory=lambda: os.getenv("DB_NAME", "polycodehub"))
    db_user: str = field(default_factory=lambda: os.getenv("DB_USER", "polycode"))
    db_password: str = field(default_factory=lambda: os.getenv("DB_PASSWORD", ""))

    redis_url: str = field(default_factory=lambda: os.getenv("REDIS_URL", "redis://redis:6379/0"))

    db_min_conn: int = field(default_factory=lambda: int(os.getenv("DB_MIN_CONN", "2")))
    db_max_conn: int = field(default_factory=lambda: int(os.getenv("DB_MAX_CONN", "10")))
    reconnect_delay_seconds: int = field(default_factory=lambda: int(os.getenv("RECONNECT_DELAY_SECONDS", "5")))

    def require(self) -> None:
        if not self.db_password:
            raise RuntimeError("DB_PASSWORD environment variable is required")

    @property
    def db_kwargs(self) -> Dict[str, object]:
        return {
            "host": self.db_host,
            "port": self.db_port,
            "dbname": self.db_name,
            "user": self.db_user,
            "password": self.db_password,
        }


settings = Settings()
