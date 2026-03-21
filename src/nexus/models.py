"""Validation for entry data shapes."""

from __future__ import annotations

from datetime import UTC, date, datetime

# --- Workout validation ---

STRENGTH_KEYS = {"exercise", "exercise_key", "sets", "notes"}
CARDIO_KEYS = {"exercise", "exercise_key", "duration_min", "distance_km", "notes"}
ALL_WORKOUT_KEYS = STRENGTH_KEYS | CARDIO_KEYS
SET_KEYS = {"weight_kg", "reps"}

# --- Meal validation ---

MEAL_TOP_KEYS = {"meal_type", "items", "totals", "notes"}
MEAL_ITEM_REQUIRED = {"name", "quantity", "calories", "protein_g", "carbs_g", "fat_g"}


class ValidationError(ValueError):
    pass


def validate_workout(data: dict) -> dict:
    """Validate and clean a workout entry's data dict."""
    if not isinstance(data, dict):
        raise ValidationError("Workout data must be a dict.")

    exercise = data.get("exercise")
    exercise_key = data.get("exercise_key")

    if not exercise or not isinstance(exercise, str) or not exercise.strip():
        raise ValidationError("exercise is required.")
    if not exercise_key or not isinstance(exercise_key, str) or not exercise_key.strip():
        raise ValidationError("exercise_key is required.")

    # Validate exercise_key format: lowercase, underscores, no spaces
    ek = exercise_key.strip()
    if ek != ek.lower() or " " in ek or not all(c.isalnum() or c == "_" for c in ek):
        raise ValidationError(
            f"exercise_key must be lowercase_with_underscores, got: {ek!r}"
        )

    unknown = set(data.keys()) - ALL_WORKOUT_KEYS
    if unknown:
        raise ValidationError(f"Unknown workout keys: {unknown}")

    # Validate sets if present
    sets = data.get("sets")
    if sets is not None:
        if not isinstance(sets, list):
            raise ValidationError("sets must be a list.")
        for i, s in enumerate(sets):
            if not isinstance(s, dict):
                raise ValidationError(f"sets[{i}] must be a dict.")
            unknown_set = set(s.keys()) - SET_KEYS
            if unknown_set:
                raise ValidationError(f"Unknown keys in sets[{i}]: {unknown_set}")

    # Validate cardio fields
    for field in ("duration_min", "distance_km"):
        val = data.get(field)
        if val is not None:
            if not isinstance(val, (int, float)) or val < 0:
                raise ValidationError(f"{field} must be a non-negative number.")

    return data


def validate_meal(data: dict) -> dict:
    """Validate a meal entry's data dict. Computes and injects totals."""
    if not isinstance(data, dict):
        raise ValidationError("Meal data must be a dict.")

    unknown = set(data.keys()) - MEAL_TOP_KEYS
    if unknown:
        raise ValidationError(f"Unknown meal keys: {unknown}")

    items = data.get("items")
    if not items or not isinstance(items, list) or len(items) == 0:
        raise ValidationError("items is required and must be a non-empty list.")

    for i, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValidationError(f"items[{i}] must be a dict.")
        missing = MEAL_ITEM_REQUIRED - set(item.keys())
        if missing:
            raise ValidationError(f"items[{i}] missing required fields: {missing}")
        unknown_item = set(item.keys()) - MEAL_ITEM_REQUIRED
        if unknown_item:
            raise ValidationError(f"Unknown keys in items[{i}]: {unknown_item}")

    # Compute totals server-side
    totals = {"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}
    for item in items:
        for key in totals:
            val = item.get(key, 0)
            if not isinstance(val, (int, float)):
                raise ValidationError(f"items[].{key} must be a number.")
            totals[key] += val

    # Round to avoid floating point noise
    totals = {k: round(v, 1) for k, v in totals.items()}

    data["totals"] = totals
    return data


def parse_date(value: str | None) -> date:
    """Parse a YYYY-MM-DD string, default to today."""
    if value is None:
        return datetime.now(UTC).date()
    try:
        return date.fromisoformat(value.strip())
    except (ValueError, AttributeError) as exc:
        raise ValidationError(f"Invalid date format: {value!r}. Use YYYY-MM-DD.") from exc
