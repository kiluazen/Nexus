from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from nipp.config import Settings
from nipp.db import get_pool
from nipp.models import WorkoutEntry


class PostgresWorkoutStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def log_workout_entry(
        self,
        *,
        user_id: str,
        event_at: str,
        exercise: str,
        request_id: str,
        sets: int | None = None,
        reps: int | None = None,
        weight: float | None = None,
        duration_min: int | None = None,
        notes: str | None = None,
    ) -> dict[str, Any]:
        entry = WorkoutEntry.new_workout(
            user_id=user_id,
            event_at=event_at,
            exercise=exercise,
            request_id=request_id,
            sets=sets,
            reps=reps,
            weight=weight,
            duration_min=duration_min,
            notes=notes,
        )
        inserted_id = self._insert_payload(entry.to_dict())
        return {
            "status": "created",
            "id": inserted_id,
            "entry": entry.to_dict(),
        }

    def get_workout_history(
        self,
        *,
        user_id: str,
        from_date: str | None = None,
        to_date: str | None = None,
        exercise: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        if limit <= 0:
            raise ValueError("limit must be greater than 0.")

        filters = {
            "from_date": from_date,
            "to_date": to_date,
            "exercise": (exercise or "").strip() or None,
            "limit": limit,
        }
        entries = self._workout_history_payloads(
            user_id=user_id,
            from_date=from_date,
            to_date=to_date,
            exercise=filters["exercise"],
            limit=limit,
        )
        summary = _build_workout_summary(entries)
        highlights = _build_workout_highlights(entries)
        groups = _group_workout_entries(entries)
        return {
            "filters": filters,
            "summary": summary,
            "highlights": highlights,
            "groups": groups,
            "entries": entries,
            "count": len(entries),
        }

    def log_generic_event(
        self,
        *,
        user_id: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        cleaned_event_type = event_type.strip().upper()
        if not cleaned_event_type:
            raise ValueError("event_type is required.")

        if not isinstance(payload, dict) or not payload:
            raise ValueError("payload must be a non-empty object.")

        table_name = _validate_identifier(self._settings.generic_events_table_name)
        stored_payload = dict(payload)
        inserted_id = self._insert_generic_event(
            table_name=table_name,
            user_id=user_id,
            event_type=cleaned_event_type,
            payload=stored_payload,
        )
        return {
            "status": "created",
            "id": inserted_id,
            "event_type": cleaned_event_type,
            "payload": stored_payload,
        }

    def _insert_payload(self, payload: dict[str, Any]) -> int:
        table_name = _validate_identifier(self._settings.table_name)
        pool = get_pool(self._settings)
        with pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    insert into {table_name} (user_id, request_id, raw_json)
                    values (%s, %s, %s::jsonb)
                    returning id
                    """,
                    (
                        payload.get("user_id", ""),
                        payload.get("request_id", ""),
                        json.dumps(payload),
                    ),
                )
                inserted_id = cursor.fetchone()[0]
            connection.commit()
        return inserted_id

    def _workout_history_payloads(
        self,
        *,
        user_id: str,
        from_date: str | None,
        to_date: str | None,
        exercise: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        table_name = _validate_identifier(self._settings.table_name)
        clauses = [
            "user_id = %s",
            "raw_json ->> 'entry_type' = 'workout'",
        ]
        params: list[Any] = [user_id]

        if from_date:
            clauses.append("(raw_json ->> 'event_at') >= %s")
            params.append(from_date)
        if to_date:
            clauses.append("(raw_json ->> 'event_at') <= %s")
            params.append(to_date)
        if exercise:
            clauses.append("lower(raw_json ->> 'exercise') = lower(%s)")
            params.append(exercise)

        params.append(limit)
        where_clause = " and ".join(clauses)
        pool = get_pool(self._settings)
        with pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    select id, raw_json::text
                    from {table_name}
                    where {where_clause}
                    order by raw_json ->> 'event_at' desc, id desc
                    limit %s
                    """,
                    params,
                )
                rows = cursor.fetchall()

        entries = []
        for row_id, raw_json in rows:
            entries.append(
                {
                    "id": row_id,
                    "raw_json": json.loads(raw_json),
                }
            )
        return entries

    def _insert_generic_event(
        self,
        *,
        table_name: str,
        user_id: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> int:
        pool = get_pool(self._settings)
        with pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    insert into {table_name} (user_id, event_type, raw_json)
                    values (%s, %s, %s::jsonb)
                    returning id
                    """,
                    (user_id, event_type, json.dumps(payload)),
                )
                inserted_id = cursor.fetchone()[0]
            connection.commit()
        return inserted_id


def _validate_identifier(value: str) -> str:
    if not value.replace("_", "").isalnum():
        raise ValueError("Table name must contain only letters, numbers, and underscores.")
    return value


def _build_workout_summary(entries: list[dict[str, Any]]) -> dict[str, Any]:
    unique_exercises: set[str] = set()
    total_sets = 0
    heaviest_weight = 0.0

    for entry in entries:
        payload = entry["raw_json"]
        exercise = str(payload.get("exercise", "")).strip()
        if exercise:
            unique_exercises.add(exercise.lower())
        sets = payload.get("sets", "")
        if str(sets).strip().isdigit():
            total_sets += int(str(sets))
        weight = payload.get("weight", "")
        try:
            heaviest_weight = max(heaviest_weight, float(str(weight)))
        except ValueError:
            pass

    return {
        "total_workouts": len(entries),
        "unique_exercises": len(unique_exercises),
        "total_sets": total_sets,
        "heaviest_weight": heaviest_weight,
    }


def _build_workout_highlights(entries: list[dict[str, Any]]) -> dict[str, Any]:
    if not entries:
        return {
            "latest_workout": None,
            "heaviest_set": None,
        }

    heaviest_entry = None
    heaviest_weight = -1.0
    for entry in entries:
        payload = entry["raw_json"]
        try:
            weight = float(str(payload.get("weight", "")))
        except ValueError:
            continue
        if weight > heaviest_weight:
            heaviest_weight = weight
            heaviest_entry = entry

    return {
        "latest_workout": entries[0],
        "heaviest_set": heaviest_entry,
    }


def _group_workout_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        payload = entry["raw_json"]
        event_at = str(payload.get("event_at", ""))
        day = event_at[:10] if len(event_at) >= 10 else "Unknown"
        grouped[day].append(entry)

    groups = []
    for day, day_entries in grouped.items():
        groups.append(
            {
                "date": day,
                "entries": day_entries,
                "count": len(day_entries),
            }
        )
    return groups
