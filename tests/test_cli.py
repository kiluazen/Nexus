from __future__ import annotations

import argparse
import io
import os
import tempfile
import unittest
from unittest import mock

from nexus.cli import CliError, _read_entries, resolve_base_url


class ResolveBaseUrlTests(unittest.TestCase):
    def test_prefers_explicit_value(self) -> None:
        self.assertEqual("https://api.example.com", resolve_base_url(explicit="https://api.example.com"))

    def test_uses_env_value(self) -> None:
        with mock.patch.dict(os.environ, {"NEXUS_API_BASE_URL": "https://env.example.com"}, clear=False):
            self.assertEqual("https://env.example.com", resolve_base_url())

    def test_uses_saved_credentials(self) -> None:
        creds = {"base_url": "https://saved.example.com", "token": "t"}
        with mock.patch("nexus.cli.load_saved_credentials", return_value=creds):
            self.assertEqual("https://saved.example.com", resolve_base_url())

    def test_raises_when_missing(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(CliError):
                resolve_base_url(allow_saved=False)

    def test_strips_trailing_slash(self) -> None:
        self.assertEqual("https://api.example.com", resolve_base_url(explicit="https://api.example.com/"))


class ReadEntriesTests(unittest.TestCase):
    def test_loads_from_inline_json(self) -> None:
        args = argparse.Namespace(file=None, entries='[{"type":"meal"}]', stdin=False)
        self.assertEqual([{"type": "meal"}], _read_entries(args))

    def test_loads_from_stdin(self) -> None:
        args = argparse.Namespace(file=None, entries=None, stdin=True)
        with mock.patch("sys.stdin", io.StringIO('[{"type":"workout"}]')):
            self.assertEqual([{"type": "workout"}], _read_entries(args))

    def test_loads_from_file(self) -> None:
        args = argparse.Namespace(entries=None, stdin=False)
        with tempfile.NamedTemporaryFile("w+", encoding="utf-8") as f:
            f.write('[{"type":"meal"}]')
            f.flush()
            args.file = f.name
            self.assertEqual([{"type": "meal"}], _read_entries(args))

    def test_rejects_non_list_payload(self) -> None:
        args = argparse.Namespace(file=None, entries='{"type":"meal"}', stdin=False)
        with self.assertRaises(CliError):
            _read_entries(args)

    def test_rejects_invalid_json(self) -> None:
        args = argparse.Namespace(file=None, entries="not json", stdin=False)
        with self.assertRaises(CliError):
            _read_entries(args)


if __name__ == "__main__":
    unittest.main()
