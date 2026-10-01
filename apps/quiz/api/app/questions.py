"""Loading, validating and saving the question bank (content/questions.json).

Standard library only, so the CLI can import it on the host without FastAPI.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
NUM_CHOICES = 4
MAX_QUESTION_LEN = 200
MAX_CHOICE_LEN = 40
MAX_CATEGORY_LEN = 24


class QuestionError(ValueError):
    pass


@dataclass(frozen=True)
class Question:
    id: str
    category: str
    question: str
    choices: tuple[str, ...]
    answer: int

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "category": self.category,
            "question": self.question,
            "choices": list(self.choices),
            "answer": self.answer,
        }


def _text(raw: dict, key: str, max_len: int, where: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip():
        raise QuestionError(f"{where}: '{key}' must be a non-empty string")
    value = value.strip()
    if len(value) > max_len:
        raise QuestionError(f"{where}: '{key}' is longer than {max_len} characters")
    return value


def validate_question(raw: object, where: str = "question") -> Question:
    if not isinstance(raw, dict):
        raise QuestionError(f"{where}: must be an object")
    extra = set(raw) - {"id", "category", "question", "choices", "answer"}
    if extra:
        raise QuestionError(f"{where}: unknown field(s) {sorted(extra)}")

    qid = raw.get("id")
    if not isinstance(qid, str) or not ID_RE.fullmatch(qid) or len(qid) > 40:
        raise QuestionError(f"{where}: 'id' must look like 'space-01' (lowercase letters, digits, dashes)")
    where = f"question '{qid}'"

    category = _text(raw, "category", MAX_CATEGORY_LEN, where)
    text = _text(raw, "question", MAX_QUESTION_LEN, where)

    choices = raw.get("choices")
    if not isinstance(choices, list) or len(choices) != NUM_CHOICES:
        raise QuestionError(f"{where}: 'choices' must be a list of exactly {NUM_CHOICES} answers")
    cleaned = []
    for i, c in enumerate(choices):
        if not isinstance(c, str) or not c.strip():
            raise QuestionError(f"{where}: choice {i + 1} must be a non-empty string")
        if len(c.strip()) > MAX_CHOICE_LEN:
            raise QuestionError(f"{where}: choice {i + 1} is longer than {MAX_CHOICE_LEN} characters")
        cleaned.append(c.strip())
    if len({c.casefold() for c in cleaned}) != NUM_CHOICES:
        raise QuestionError(f"{where}: the {NUM_CHOICES} choices must all be different")

    answer = raw.get("answer")
    if isinstance(answer, bool) or not isinstance(answer, int) or not 0 <= answer < NUM_CHOICES:
        raise QuestionError(f"{where}: 'answer' must be the index of the right choice (0-{NUM_CHOICES - 1})")

    return Question(qid, category, text, tuple(cleaned), answer)


def parse_bank(data: object) -> list[Question]:
    if not isinstance(data, dict) or not isinstance(data.get("questions"), list):
        raise QuestionError("file must look like {\"questions\": [...]}")
    questions = [validate_question(q, f"question #{i + 1}") for i, q in enumerate(data["questions"])]
    seen: set[str] = set()
    for q in questions:
        if q.id in seen:
            raise QuestionError(f"duplicate id '{q.id}'")
        seen.add(q.id)
    if not questions:
        raise QuestionError("there are no questions")
    return questions


def load_bank(path: Path) -> list[Question]:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise QuestionError(f"{path}: not valid JSON (line {e.lineno}: {e.msg})") from e
    return parse_bank(data)


def save_bank(path: Path, questions: list[Question]) -> None:
    """Validate, then atomically replace the file (keeping group-writable permissions)."""
    parse_bank({"questions": [q.to_json() for q in questions]})
    body = json.dumps({"questions": [q.to_json() for q in questions]}, ensure_ascii=False, indent=2) + "\n"
    fd, tmp = tempfile.mkstemp(prefix=".questions-", suffix=".json.tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
        try:
            st = path.stat()
            os.chmod(tmp, st.st_mode & 0o777)
            try:
                os.chown(tmp, -1, st.st_gid)
            except (PermissionError, AttributeError):
                pass
        except FileNotFoundError:
            os.chmod(tmp, 0o664)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


class BankCache:
    """Re-reads the question file when it changes; keeps the last good copy if it breaks."""

    def __init__(self, path: Path):
        self.path = path
        self._mtime: float | None = None
        self._questions: list[Question] = []
        self.error: str | None = None

    def get(self) -> list[Question]:
        try:
            mtime = self.path.stat().st_mtime_ns
        except OSError as e:
            self.error = f"cannot read question file: {e.strerror}"
            return self._questions
        if mtime != self._mtime:
            try:
                self._questions = load_bank(self.path)
                self.error = None
            except (OSError, QuestionError) as e:
                self.error = str(e)
            self._mtime = mtime
        return self._questions
