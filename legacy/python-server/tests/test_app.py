from __future__ import annotations

import unittest

from nexus.app import NexusApp, UserContext


class FakeStore:
    def __init__(self) -> None:
        self.ensure_user_calls: list[tuple[str, str]] = []
        self.last_log_args = None
        self.last_history_args = None
        self.last_update_args = None
        self.last_friends_args = None

    def ensure_user(self, *, user_id: str, display_name: str) -> None:
        self.ensure_user_calls.append((user_id, display_name))

    def log_entries(self, *, user_id: str, entries: list[dict], date_str: str | None = None) -> list[dict]:
        self.last_log_args = (user_id, entries, date_str)
        return [{"id": 1}]

    def get_history(
        self,
        *,
        user_id: str,
        date_str: str | None = None,
        from_date_str: str | None = None,
        to_date_str: str | None = None,
        entry_type: str | None = None,
        friend_id: str | None = None,
    ) -> dict:
        self.last_history_args = (
            user_id,
            date_str,
            from_date_str,
            to_date_str,
            entry_type,
            friend_id,
        )
        return {"workouts": [], "meals": []}

    def update_entry(self, *, user_id: str, entry_id: int, data: dict) -> dict:
        self.last_update_args = (user_id, entry_id, data)
        return {"id": entry_id, "updated": True}

    def manage_friends(
        self,
        *,
        user_id: str,
        action: str,
        code: str | None = None,
        display_name: str | None = None,
    ) -> dict:
        self.last_friends_args = (user_id, action, code, display_name)
        return {"status": "ok"}


class NexusAppTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = FakeStore()
        self.app = NexusApp(self.store)  # type: ignore[arg-type]
        self.user = UserContext(user_id="user-123", display_name="Kushal")

    def test_log_entries_uses_store_and_ensures_user(self) -> None:
        result = self.app.log_entries(
            user=self.user,
            entries=[{"type": "workout", "exercise": "Bench", "exercise_key": "bench"}],
            date="2026-03-28",
        )
        self.assertEqual({"logged": [{"id": 1}]}, result)
        self.assertEqual([("user-123", "Kushal")], self.store.ensure_user_calls)
        self.assertEqual(
            ("user-123", [{"type": "workout", "exercise": "Bench", "exercise_key": "bench"}], "2026-03-28"),
            self.store.last_log_args,
        )

    def test_get_history_forwards_filters(self) -> None:
        result = self.app.get_history(
            user=self.user,
            date=None,
            from_date="2026-03-20",
            to_date="2026-03-28",
            entry_type="workout",
            friend_id="friend-1",
        )
        self.assertEqual({"workouts": [], "meals": []}, result)
        self.assertEqual(
            ("user-123", None, "2026-03-20", "2026-03-28", "workout", "friend-1"),
            self.store.last_history_args,
        )

    def test_update_entry_forwards_payload(self) -> None:
        result = self.app.update_entry(
            user=self.user,
            entry_id=42,
            data={"meal_type": "lunch", "items": []},
        )
        self.assertEqual({"id": 42, "updated": True}, result)
        self.assertEqual(("user-123", 42, {"meal_type": "lunch", "items": []}), self.store.last_update_args)

    def test_manage_friends_forwards_action(self) -> None:
        result = self.app.manage_friends(
            user=self.user,
            action="add",
            code="NEXUS-1234",
        )
        self.assertEqual({"status": "ok"}, result)
        self.assertEqual(("user-123", "add", "NEXUS-1234", None), self.store.last_friends_args)


if __name__ == "__main__":
    unittest.main()
