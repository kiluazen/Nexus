from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

ENTRY_COLUMNS = [
    "entry_id",
    "user_id",
    "entry_type",
    "created_at",
    "event_at",
    "source",
    "request_id",
    "text",
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
    "exercise",
    "sets",
    "reps",
    "weight",
    "duration_min",
    "notes",
    "deleted_at",
]


def utc_now_rfc3339() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_timestamp(value: str | None, *, default_now: bool = False) -> str:
    if value is None:
        if default_now:
            return utc_now_rfc3339()
        raise ValueError("Timestamp is required.")

    raw = value.strip()
    if not raw:
        if default_now:
            return utc_now_rfc3339()
        raise ValueError("Timestamp cannot be empty.")

    if len(raw) == 10:
        raw = f"{raw}T00:00:00Z"

    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"

    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError(
            "Timestamp must be ISO 8601 or RFC3339, for example 2026-03-09T07:30:00Z."
        ) from exc

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)

    return parsed.astimezone(UTC).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def validate_positive_int(name: str, value: int | None) -> int | None:
    if value is None:
        return None
    if value <= 0:
        raise ValueError(f"{name} must be greater than 0.")
    return value


def validate_non_negative_number(name: str, value: float | None) -> float | None:
    if value is None:
        return None
    if value < 0:
        raise ValueError(f"{name} must be non-negative.")
    return value


@dataclass(frozen=True)
class WorkoutEntry:
    entry_id: str
    user_id: str
    entry_type: str
    created_at: str
    event_at: str
    source: str
    request_id: str
    text: str
    calories: str
    protein_g: str
    carbs_g: str
    fat_g: str
    exercise: str
    sets: str
    reps: str
    weight: str
    duration_min: str
    notes: str
    deleted_at: str

    @classmethod
    def new_workout(
        cls,
        *,
        user_id: str,
        event_at: str,
        exercise: str,
        request_id: str,
        sets: int | None,
        reps: int | None,
        weight: float | None,
        duration_min: int | None,
        notes: str | None,
    ) -> "WorkoutEntry":
        cleaned_user_id = user_id.strip()
        if not cleaned_user_id:
            raise ValueError("user_id is required.")

        cleaned_exercise = exercise.strip()
        if not cleaned_exercise:
            raise ValueError("exercise is required.")

        cleaned_request_id = request_id.strip()
        if not cleaned_request_id:
            raise ValueError("request_id is required.")

        validated_sets = validate_positive_int("sets", sets)
        validated_reps = validate_positive_int("reps", reps)
        validated_duration = validate_positive_int("duration_min", duration_min)
        validated_weight = validate_non_negative_number("weight", weight)
        normalized_event_at = normalize_timestamp(event_at)
        created_at = utc_now_rfc3339()

        return cls(
            entry_id=str(uuid4()),
            user_id=cleaned_user_id,
            entry_type="workout",
            created_at=created_at,
            event_at=normalized_event_at,
            source="chatgpt",
            request_id=cleaned_request_id,
            text=cleaned_exercise,
            calories="",
            protein_g="",
            carbs_g="",
            fat_g="",
            exercise=cleaned_exercise,
            sets=_string_or_blank(validated_sets),
            reps=_string_or_blank(validated_reps),
            weight=_string_or_blank(validated_weight),
            duration_min=_string_or_blank(validated_duration),
            notes=(notes or "").strip(),
            deleted_at="",
        )

    @classmethod
    def from_row(cls, row: list[str]) -> "WorkoutEntry":
        padded = list(row) + [""] * max(0, len(ENTRY_COLUMNS) - len(row))
        values = dict(zip(ENTRY_COLUMNS, padded[: len(ENTRY_COLUMNS)], strict=False))
        return cls(**values)

    def to_row(self) -> list[str]:
        data = asdict(self)
        return [data[column] for column in ENTRY_COLUMNS]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _string_or_blank(value: Any) -> str:
    return "" if value is None else str(value)
