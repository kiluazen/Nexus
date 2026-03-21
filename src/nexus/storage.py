"""Postgres storage layer for NEXUS v2."""

from __future__ import annotations

import json
import random
import string
from datetime import UTC, date, datetime, timedelta
from typing import Any

from nexus.config import Settings
from nexus.db import get_pool
from nexus.models import ValidationError, parse_date, validate_meal, validate_workout


class Store:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    # ----------------------------------------------------------------- user
    def ensure_user(self, *, user_id: str, display_name: str) -> None:
        """Create user row if it doesn't exist. No-op if it does."""
        pool = get_pool(self._settings)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO users (id, display_name)
                    VALUES (%s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (user_id, display_name),
                )
            conn.commit()

    # ------------------------------------------------------------------ log
    def log_entries(
        self,
        *,
        user_id: str,
        entries: list[dict[str, Any]],
        date_str: str | None = None,
    ) -> list[dict[str, Any]]:
        entry_date = parse_date(date_str)
        results = []
        for entry in entries:
            entry_type = entry.get("type")
            if entry_type == "workout":
                results.append(self._insert_workout(user_id, entry_date, entry))
            elif entry_type == "meal":
                results.append(self._insert_meal(user_id, entry_date, entry))
            else:
                raise ValidationError(f"Unknown entry type: {entry_type!r}. Must be 'workout' or 'meal'.")
        return results

    def _insert_workout(self, user_id: str, entry_date: date, entry: dict) -> dict:
        data = {k: v for k, v in entry.items() if k != "type"}
        data = validate_workout(data)
        exercise_key = data["exercise_key"].strip()

        pool = get_pool(self._settings)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO entries (user_id, entry_type, date, exercise_key, data)
                    VALUES (%s, 'workout', %s, %s, %s::jsonb)
                    RETURNING id
                    """,
                    (user_id, entry_date, exercise_key, json.dumps(data)),
                )
                row_id = cur.fetchone()[0]
            conn.commit()

        sets = data.get("sets")
        result = {
            "id": row_id,
            "entry_type": "workout",
            "exercise_key": exercise_key,
        }
        if sets and isinstance(sets, list):
            result["total_sets"] = len(sets)
        if "duration_min" in data:
            result["duration_min"] = data["duration_min"]
        return result

    def _insert_meal(self, user_id: str, entry_date: date, entry: dict) -> dict:
        data = {k: v for k, v in entry.items() if k != "type"}
        data = validate_meal(data)  # computes totals

        pool = get_pool(self._settings)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO entries (user_id, entry_type, date, exercise_key, data)
                    VALUES (%s, 'meal', %s, NULL, %s::jsonb)
                    RETURNING id
                    """,
                    (user_id, entry_date, json.dumps(data)),
                )
                row_id = cur.fetchone()[0]
            conn.commit()

        return {
            "id": row_id,
            "entry_type": "meal",
            "meal_type": data.get("meal_type"),
            "totals": data["totals"],
            "items_count": len(data["items"]),
        }

    # -------------------------------------------------------------- history
    def get_history(
        self,
        *,
        user_id: str,
        date_str: str | None = None,
        from_date_str: str | None = None,
        to_date_str: str | None = None,
        entry_type: str | None = None,
        friend_id: str | None = None,
    ) -> dict[str, Any]:
        # If querying a friend, verify friendship and swap target
        query_user_id = user_id
        if friend_id:
            if not self._are_friends(user_id, friend_id):
                raise ValidationError("Not friends with this user.")
            query_user_id = friend_id
        # Determine date range
        if date_str:
            d = parse_date(date_str)
            from_date, to_date = d, d
        elif from_date_str or to_date_str:
            from_date = parse_date(from_date_str) if from_date_str else parse_date(to_date_str)
            to_date = parse_date(to_date_str) if to_date_str else parse_date(from_date_str)
        else:
            # Default: last 7 days
            today = datetime.now(UTC).date()
            from_date = today - timedelta(days=6)
            to_date = today

        clauses = ["user_id = %s", "date >= %s", "date <= %s"]
        params: list[Any] = [query_user_id, from_date, to_date]

        if entry_type:
            if entry_type not in ("workout", "meal"):
                raise ValidationError("type must be 'workout' or 'meal'.")
            clauses.append("entry_type = %s")
            params.append(entry_type)

        where = " AND ".join(clauses)

        pool = get_pool(self._settings)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT id, entry_type, date, exercise_key, data::text
                    FROM entries
                    WHERE {where}
                    ORDER BY date DESC, id DESC
                    """,
                    params,
                )
                rows = cur.fetchall()

                # Get exercise keys (only for own queries)
                exercise_keys = []
                if not friend_id:
                    cur.execute(
                        """
                        SELECT DISTINCT exercise_key FROM entries
                        WHERE user_id = %s AND exercise_key IS NOT NULL
                        ORDER BY exercise_key
                        """,
                        (user_id,),
                    )
                    exercise_keys = [r[0] for r in cur.fetchall()]

                # Get pending friend request count (only for own queries)
                pending_count = 0
                if not friend_id:
                    cur.execute(
                        """
                        SELECT COUNT(*) FROM friendships
                        WHERE recipient_id = %s AND status = 'pending'
                        """,
                        (user_id,),
                    )
                    pending_count = cur.fetchone()[0]

        workouts = []
        meals = []
        for row_id, etype, edate, ekey, data_text in rows:
            data = json.loads(data_text)
            if etype == "workout":
                entry_out = {"id": row_id, "date": edate.isoformat()}
                entry_out.update(data)
                workouts.append(entry_out)
            elif etype == "meal":
                entry_out = {
                    "id": row_id,
                    "date": edate.isoformat(),
                    "meal_type": data.get("meal_type"),
                    "items": data.get("items", []),
                    "totals": data.get("totals", {}),
                }
                if data.get("notes"):
                    entry_out["notes"] = data["notes"]
                meals.append(entry_out)

        # Compute day_totals only for single-day queries
        single_day = from_date == to_date
        result: dict[str, Any] = {
            "period": {"from": from_date.isoformat(), "to": to_date.isoformat()},
            "workouts": workouts,
            "meals": meals,
        }

        if not friend_id:
            result["your_exercises"] = exercise_keys
            if pending_count > 0:
                result["pending_friend_requests"] = pending_count

        if single_day:
            total_sets = 0
            for w in workouts:
                sets = w.get("sets")
                if isinstance(sets, list):
                    total_sets += len(sets)

            cal = sum(m.get("totals", {}).get("calories", 0) for m in meals)
            pro = sum(m.get("totals", {}).get("protein_g", 0) for m in meals)
            carb = sum(m.get("totals", {}).get("carbs_g", 0) for m in meals)
            fat = sum(m.get("totals", {}).get("fat_g", 0) for m in meals)

            result["day_totals"] = {
                "exercises": len(workouts),
                "total_sets": total_sets,
                "calories": round(cal, 1),
                "protein_g": round(pro, 1),
                "carbs_g": round(carb, 1),
                "fat_g": round(fat, 1),
                "meals_logged": len(meals),
            }

        return result

    # -------------------------------------------------------------- update
    def update_entry(
        self,
        *,
        user_id: str,
        entry_id: int,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        # First fetch the existing entry to know its type
        pool = get_pool(self._settings)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT entry_type, exercise_key FROM entries WHERE id = %s AND user_id = %s",
                    (entry_id, user_id),
                )
                row = cur.fetchone()
                if row is None:
                    raise ValidationError(f"Entry {entry_id} not found or not owned by you.")

                entry_type, exercise_key = row

                # Validate based on type
                if entry_type == "workout":
                    data = validate_workout(data)
                    new_exercise_key = data["exercise_key"].strip()
                elif entry_type == "meal":
                    data = validate_meal(data)  # recomputes totals
                    new_exercise_key = None
                else:
                    raise ValidationError(f"Cannot update entry of type: {entry_type}")

                cur.execute(
                    """
                    UPDATE entries
                    SET data = %s::jsonb, exercise_key = %s, updated_at = now()
                    WHERE id = %s AND user_id = %s
                    RETURNING id
                    """,
                    (json.dumps(data), new_exercise_key, entry_id, user_id),
                )
                cur.fetchone()
            conn.commit()

        result: dict[str, Any] = {
            "id": entry_id,
            "entry_type": entry_type,
            "updated": True,
        }
        if entry_type == "workout":
            result["exercise_key"] = data.get("exercise_key")
            sets = data.get("sets")
            if isinstance(sets, list):
                result["total_sets"] = len(sets)
            if "duration_min" in data:
                result["duration_min"] = data["duration_min"]
        elif entry_type == "meal":
            result["totals"] = data["totals"]
            result["items_count"] = len(data.get("items", []))

        return result

    # ------------------------------------------------------------- friends
    def manage_friends(
        self,
        *,
        user_id: str,
        action: str,
        code: str | None = None,
        display_name: str | None = None,
    ) -> dict[str, Any]:
        if action == "list":
            return self._friends_list(user_id)
        elif action == "add":
            if not code:
                raise ValidationError("code is required for 'add'.")
            return self._friends_add(user_id, code.strip().upper())
        elif action == "accept":
            if not display_name:
                raise ValidationError("display_name is required for 'accept'.")
            return self._friends_accept_or_reject(user_id, display_name.strip(), accept=True)
        elif action == "reject":
            if not display_name:
                raise ValidationError("display_name is required for 'reject'.")
            return self._friends_accept_or_reject(user_id, display_name.strip(), accept=False)
        elif action == "remove":
            if not display_name:
                raise ValidationError("display_name is required for 'remove'.")
            return self._friends_remove(user_id, display_name.strip())
        else:
            raise ValidationError(f"Unknown action: {action!r}. Use list/add/accept/reject/remove.")

    def _ensure_friend_code(self, user_id: str) -> str:
        pool = get_pool(self._settings)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT friend_code FROM users WHERE id = %s", (user_id,))
                row = cur.fetchone()
                if row and row[0]:
                    return row[0]
                for _ in range(10):
                    code = "NEXUS-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
                    cur.execute("SELECT 1 FROM users WHERE friend_code = %s", (code,))
                    if cur.fetchone() is None:
                        cur.execute("UPDATE users SET friend_code = %s WHERE id = %s", (code, user_id))
                        conn.commit()
                        return code
                raise ValidationError("Failed to generate unique friend code.")

    def _friends_list(self, user_id: str) -> dict[str, Any]:
        my_code = self._ensure_friend_code(user_id)
        pool = get_pool(self._settings)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT u.id, u.display_name, f.created_at::date FROM friendships f
                    JOIN users u ON u.id = CASE WHEN f.requester_id = %s THEN f.recipient_id ELSE f.requester_id END
                    WHERE (f.requester_id = %s OR f.recipient_id = %s) AND f.status = 'active'
                    ORDER BY u.display_name""",
                    (user_id, user_id, user_id),
                )
                friends = [{"user_id": r[0], "display_name": r[1], "since": r[2].isoformat()} for r in cur.fetchall()]
                cur.execute(
                    """SELECT u.id, u.display_name FROM friendships f
                    JOIN users u ON u.id = f.requester_id
                    WHERE f.recipient_id = %s AND f.status = 'pending'
                    ORDER BY f.created_at DESC""",
                    (user_id,),
                )
                pending_received = [{"user_id": r[0], "display_name": r[1]} for r in cur.fetchall()]
                cur.execute(
                    """SELECT u.id, u.display_name FROM friendships f
                    JOIN users u ON u.id = f.recipient_id
                    WHERE f.requester_id = %s AND f.status = 'pending'
                    ORDER BY f.created_at DESC""",
                    (user_id,),
                )
                pending_sent = [{"user_id": r[0], "display_name": r[1]} for r in cur.fetchall()]
        return {"your_code": my_code, "friends": friends, "pending_received": pending_received, "pending_sent": pending_sent}

    def _friends_add(self, user_id: str, code: str) -> dict[str, Any]:
        pool = get_pool(self._settings)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, display_name FROM users WHERE friend_code = %s", (code,))
                row = cur.fetchone()
                if row is None:
                    raise ValidationError(f"No user found with code {code}")
                target_id, target_name = row
                if target_id == user_id:
                    raise ValidationError("You can't add yourself.")
                cur.execute(
                    """SELECT status FROM friendships
                    WHERE (requester_id = %s AND recipient_id = %s) OR (requester_id = %s AND recipient_id = %s)""",
                    (user_id, target_id, target_id, user_id),
                )
                existing = cur.fetchone()
                if existing:
                    if existing[0] == "active":
                        return {"status": "already_friends", "with": target_name}
                    return {"status": "already_pending", "with": target_name}
                cur.execute(
                    "INSERT INTO friendships (requester_id, recipient_id, status) VALUES (%s, %s, 'pending')",
                    (user_id, target_id),
                )
            conn.commit()
        return {"status": "request_sent", "to": target_name}

    def _friends_accept_or_reject(self, user_id: str, display_name: str, *, accept: bool) -> dict[str, Any]:
        pool = get_pool(self._settings)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT f.id, u.display_name FROM friendships f
                    JOIN users u ON u.id = f.requester_id
                    WHERE f.recipient_id = %s AND f.status = 'pending' AND u.display_name = %s""",
                    (user_id, display_name),
                )
                row = cur.fetchone()
                if row is None:
                    raise ValidationError(f"No pending request from '{display_name}'.")
                friendship_id, name = row
                if accept:
                    cur.execute("UPDATE friendships SET status = 'active' WHERE id = %s", (friendship_id,))
                    conn.commit()
                    return {"status": "accepted", "friend": name}
                else:
                    cur.execute("DELETE FROM friendships WHERE id = %s", (friendship_id,))
                    conn.commit()
                    return {"status": "rejected", "name": name}

    def _friends_remove(self, user_id: str, display_name: str) -> dict[str, Any]:
        pool = get_pool(self._settings)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """DELETE FROM friendships WHERE id IN (
                        SELECT f.id FROM friendships f
                        JOIN users u ON u.id = CASE WHEN f.requester_id = %s THEN f.recipient_id ELSE f.requester_id END
                        WHERE (f.requester_id = %s OR f.recipient_id = %s) AND u.display_name = %s
                    ) RETURNING id""",
                    (user_id, user_id, user_id, display_name),
                )
                deleted = cur.fetchone()
            conn.commit()
        if deleted is None:
            raise ValidationError(f"No friend named '{display_name}' found.")
        return {"status": "removed", "name": display_name}

    def _are_friends(self, user_id: str, friend_id: str) -> bool:
        pool = get_pool(self._settings)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT 1 FROM friendships WHERE status = 'active'
                    AND ((requester_id = %s AND recipient_id = %s) OR (requester_id = %s AND recipient_id = %s))""",
                    (user_id, friend_id, friend_id, user_id),
                )
                return cur.fetchone() is not None
