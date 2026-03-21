from __future__ import annotations

import unittest
from datetime import date

from nexus.models import (
    ValidationError,
    parse_date,
    validate_meal,
    validate_workout,
)


class ParseDateTests(unittest.TestCase):
    def test_valid_date(self) -> None:
        self.assertEqual(parse_date("2026-03-20"), date(2026, 3, 20))

    def test_none_defaults_to_today(self) -> None:
        result = parse_date(None)
        self.assertIsInstance(result, date)

    def test_invalid_date_raises(self) -> None:
        with self.assertRaises(ValidationError):
            parse_date("not-a-date")


class ValidateWorkoutTests(unittest.TestCase):
    def test_valid_strength(self) -> None:
        data = validate_workout({
            "exercise": "Bench Press",
            "exercise_key": "bench_press",
            "sets": [{"weight_kg": 60, "reps": 8}],
        })
        self.assertEqual(data["exercise_key"], "bench_press")

    def test_valid_cardio(self) -> None:
        data = validate_workout({
            "exercise": "Treadmill",
            "exercise_key": "treadmill",
            "duration_min": 10,
            "distance_km": 1.5,
        })
        self.assertEqual(data["duration_min"], 10)

    def test_missing_exercise_raises(self) -> None:
        with self.assertRaises(ValidationError):
            validate_workout({"exercise_key": "test"})

    def test_missing_exercise_key_raises(self) -> None:
        with self.assertRaises(ValidationError):
            validate_workout({"exercise": "Test"})

    def test_bad_exercise_key_format(self) -> None:
        with self.assertRaises(ValidationError):
            validate_workout({
                "exercise": "Test",
                "exercise_key": "Bad Key",
            })

    def test_uppercase_exercise_key_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            validate_workout({
                "exercise": "Test",
                "exercise_key": "Bench_Press",
            })

    def test_unknown_keys_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            validate_workout({
                "exercise": "Test",
                "exercise_key": "test",
                "foo": "bar",
            })

    def test_notes_allowed(self) -> None:
        data = validate_workout({
            "exercise": "Squat",
            "exercise_key": "squat",
            "sets": [{"weight_kg": 80, "reps": 5}],
            "notes": "felt heavy",
        })
        self.assertEqual(data["notes"], "felt heavy")


class ValidateMealTests(unittest.TestCase):
    def _meal_item(self, **overrides):
        base = {
            "name": "chapati", "quantity": 2,
            "calories": 220, "protein_g": 6, "carbs_g": 40, "fat_g": 4,
        }
        base.update(overrides)
        return base

    def test_valid_meal_computes_totals(self) -> None:
        data = validate_meal({
            "meal_type": "lunch",
            "items": [
                self._meal_item(calories=220, protein_g=6),
                self._meal_item(name="egg", calories=235, protein_g=18),
            ],
        })
        self.assertEqual(data["totals"]["calories"], 455)
        self.assertEqual(data["totals"]["protein_g"], 24)

    def test_empty_items_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            validate_meal({"meal_type": "lunch", "items": []})

    def test_missing_item_field_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            validate_meal({
                "meal_type": "lunch",
                "items": [{"name": "apple"}],
            })

    def test_unknown_item_keys_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            validate_meal({
                "meal_type": "lunch",
                "items": [
                    {**self._meal_item(), "brand": "Amul"},
                ],
            })

    def test_unknown_top_keys_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            validate_meal({
                "meal_type": "lunch",
                "items": [self._meal_item()],
                "restaurant": "McDonalds",
            })


if __name__ == "__main__":
    unittest.main()
