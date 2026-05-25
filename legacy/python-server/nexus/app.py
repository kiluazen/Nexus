from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from nexus.models import ValidationError

if TYPE_CHECKING:
    from nexus.storage import Store


@dataclass(frozen=True)
class UserContext:
    user_id: str
    display_name: str


class NexusApp:
    def __init__(self, store: Store) -> None:
        self._store = store

    def ensure_user(self, user: UserContext) -> None:
        self._store.ensure_user(user_id=user.user_id, display_name=user.display_name)

    def log_entries(
        self,
        *,
        user: UserContext,
        entries: list[dict],
        date: str | None = None,
    ) -> dict:
        self.ensure_user(user)
        results = self._store.log_entries(
            user_id=user.user_id,
            entries=entries,
            date_str=date,
        )
        return {"logged": results}

    def get_history(
        self,
        *,
        user: UserContext,
        date: str | None = None,
        from_date: str | None = None,
        to_date: str | None = None,
        entry_type: str | None = None,
        friend_id: str | None = None,
    ) -> dict:
        self.ensure_user(user)
        return self._store.get_history(
            user_id=user.user_id,
            date_str=date,
            from_date_str=from_date,
            to_date_str=to_date,
            entry_type=entry_type,
            friend_id=friend_id,
        )

    def update_entry(
        self,
        *,
        user: UserContext,
        entry_id: int,
        data: dict,
    ) -> dict:
        self.ensure_user(user)
        return self._store.update_entry(
            user_id=user.user_id,
            entry_id=entry_id,
            data=data,
        )

    def manage_friends(
        self,
        *,
        user: UserContext,
        action: str,
        code: str | None = None,
        display_name: str | None = None,
    ) -> dict:
        self.ensure_user(user)
        return self._store.manage_friends(
            user_id=user.user_id,
            action=action,
            code=code,
            display_name=display_name,
        )


def handle_validation_error(exc: ValidationError) -> dict:
    return {"error": str(exc)}
