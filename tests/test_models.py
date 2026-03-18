from __future__ import annotations

import unittest

from nipp.models import WorkoutEntry, normalize_timestamp


class NormalizeTimestampTests(unittest.TestCase):
    def test_date_only_becomes_utc_midnight(self) -> None:
        self.assertEqual(normalize_timestamp("2026-03-09"), "2026-03-09T00:00:00Z")

    def test_timezone_offsets_are_normalized_to_utc(self) -> None:
        self.assertEqual(
            normalize_timestamp("2026-03-09T07:30:00+05:30"),
            "2026-03-09T02:00:00Z",
        )

    def test_invalid_timestamp_raises(self) -> None:
        with self.assertRaises(ValueError):
            normalize_timestamp("not-a-date")


class WorkoutEntryTests(unittest.TestCase):
    def test_new_workout_round_trips_through_row(self) -> None:
        entry = WorkoutEntry.new_workout(
            user_id="user-123",
            event_at="2026-03-09T07:30:00Z",
            exercise="Deadlift",
            request_id="req-123",
            sets=3,
            reps=5,
            weight=140,
            duration_min=20,
            notes="felt good",
        )

        restored = WorkoutEntry.from_row(entry.to_row())
        self.assertEqual(restored.user_id, "user-123")
        self.assertEqual(restored.exercise, "Deadlift")
        self.assertEqual(restored.request_id, "req-123")
        self.assertEqual(restored.weight, "140")


if __name__ == "__main__":
    unittest.main()
