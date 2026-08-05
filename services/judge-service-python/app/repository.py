import json
from typing import Any, Dict, Optional, Tuple

from pydantic import BaseModel

from .db import get_db_connection


class SubmissionMessage(BaseModel):
    submission_id: int
    user_id: int
    problem_id: int
    language: str
    source_code: str = ""
    stdin: str = ""


class RunMessage(BaseModel):
    # mode 字段从消息体 raw["mode"] 读取（worker 用 raw.get("mode") == "run" 判断），
    # 此处默认值仅供 pydantic 校验兜底，实际值由网关发送时设为 "run"。
    mode: str = "run"
    run_id: int
    user_id: int
    language: str
    source_code: str = ""
    stdin: str = ""


class Verdict(BaseModel):
    status: str
    output: Optional[str] = None
    runtime_ms: int = 0
    memory_kb: int = 0
    error_message: Optional[str] = None
    failed_case_input: Optional[str] = None
    expected_output: Optional[str] = None
    actual_output: Optional[str] = None


class TestCase(BaseModel):
    id: int
    input_data: str
    expected_output: str
    is_sample: bool


def fetch_test_cases(problem_id: int) -> list[TestCase]:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, input_data, expected_output, is_sample
                FROM test_cases
                WHERE problem_id = %s
                ORDER BY id ASC
                """,
                (problem_id,),
            )
            rows = cur.fetchall()

    return [
        TestCase(id=row[0], input_data=row[1], expected_output=row[2], is_sample=row[3])
        for row in rows
    ]


def load_submission_user(submission_id: int) -> Optional[Tuple[int, str]]:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.user_id, u.username
                FROM submissions s
                JOIN users u ON u.id = s.user_id
                WHERE s.id = %s
                """,
                (submission_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    return int(row[0]), str(row[1])


def save_verdict(submission_id: int, verdict: Verdict, actor: Optional[Tuple[int, str]]) -> Optional[str]:
    """持久化判题结果，并返回旧 status 供 worker 判定是否需要调整 AC 计数。

    S2 修复：用 SELECT FOR UPDATE 锁定行并读取旧 status，在同一事务内写新 verdict，
    保证 (old_status, new_status) 状态机原子性。返回 None 表示提交不存在。
    """
    actor_user_id, actor_username = actor if actor else (None, None)
    with get_db_connection() as conn:
        try:
            with conn.cursor() as cur:
                # 锁定行并读取旧状态，避免 rejudge 与正常判题并发更新产生竞态
                cur.execute("SELECT status FROM submissions WHERE id = %s FOR UPDATE", (submission_id,))
                row = cur.fetchone()
                if not row:
                    conn.rollback()
                    return None
                old_status = str(row[0])

                cur.execute(
                    """
                    UPDATE submissions
                    SET status = %s,
                        runtime_ms = %s,
                        memory_kb = %s,
                        error_message = %s,
                        failed_case_input = %s,
                        expected_output = %s,
                        actual_output = %s,
                        ac_counted = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        verdict.status,
                        verdict.runtime_ms,
                        verdict.memory_kb,
                        verdict.error_message,
                        verdict.failed_case_input,
                        verdict.expected_output,
                        verdict.actual_output,
                        verdict.status == "AC",
                        submission_id,
                    ),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs(action, actor_user_id, actor_username, resource_type, resource_id, detail)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                    """,
                    (
                        "submission.judged",
                        actor_user_id,
                        actor_username,
                        "submission",
                        str(submission_id),
                        json.dumps(
                            {
                                "status": verdict.status,
                                "runtime_ms": verdict.runtime_ms,
                                "memory_kb": verdict.memory_kb,
                            }
                        ),
                    ),
                )
            conn.commit()
            return old_status
        except Exception:
            conn.rollback()
            raise


def mark_submission_error(submission_id: int, message: str) -> Optional[str]:
    """worker 异常时把提交标记为 RE。返回旧 status 供 worker 调整 AC 计数。"""
    with get_db_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT status FROM submissions WHERE id = %s FOR UPDATE", (submission_id,))
                row = cur.fetchone()
                if not row:
                    conn.rollback()
                    return None
                old_status = str(row[0])
                cur.execute(
                    "UPDATE submissions SET status = 'RE', error_message = %s, ac_counted = FALSE, updated_at = NOW() WHERE id = %s",
                    (message[:500], submission_id),
                )
            conn.commit()
            return old_status
        except Exception:
            conn.rollback()
            raise


def save_run_result(run_id: int, status: str, stdout: Optional[str], stderr: Optional[str], runtime_ms: int) -> None:
    with get_db_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE runs
                    SET status = %s, stdout = %s, stderr = %s, runtime_ms = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (status, stdout, stderr, runtime_ms, run_id),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def mark_run_error(run_id: int, message: str) -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE runs SET status = 'RE', stderr = %s, updated_at = NOW() WHERE id = %s",
                (message[:500], run_id),
            )
        conn.commit()
