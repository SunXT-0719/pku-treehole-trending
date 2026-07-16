import sys
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace


BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from collector import CollectionError, TreeholeCollector  # noqa: E402


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self.payload


class SequenceSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.headers = {}
        self.cookies = {}

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if not self.responses:
            raise AssertionError("unexpected request")
        return self.responses.pop(0)


def make_collector(session):
    collector = TreeholeCollector.__new__(TreeholeCollector)
    collector.client = SimpleNamespace(session=session)
    collector._commenter_cache = {}
    collector._thread_local = threading.local()
    return collector


class CollectorTests(unittest.TestCase):
    def test_commenters_are_counted_across_pages(self):
        session = SequenceSession([
            FakeResponse({"code": 20000, "data": {
                "data": [{"cid": 1, "name": "Alice"}, {"cid": 2, "name": "Bob"}],
                "total": 3,
            }}),
            FakeResponse({"code": 20000, "data": {
                "data": [{"cid": 3, "name": "Alice"}],
                "total": 3,
            }}),
        ])
        collector = make_collector(session)

        self.assertEqual(collector.fetch_unique_commenters(42), 2)
        self.assertEqual([call[1]["params"]["page"] for call in session.calls], [1, 2])

    def test_comment_api_failure_is_not_cached_as_zero(self):
        session = SequenceSession([])
        collector = make_collector(session)
        collector._worker_session = lambda: session
        collector._fetch_unique_commenters_with_session = lambda *_: (_ for _ in ()).throw(
            CollectionError("rate limited")
        )

        with self.assertRaises(CollectionError):
            collector.fetch_all_commenters([99])

        self.assertNotIn(99, collector._commenter_cache)

    def test_partial_list_failure_does_not_return_partial_ranking_input(self):
        recent = int(time.time())
        session = SequenceSession([
            FakeResponse({"code": 20000, "data": {"list": [
                {"pid": 1, "timestamp": recent, "reply": 3, "likenum": 2}
            ]}}),
            FakeResponse({"code": 50000, "message": "upstream unavailable"}),
        ])
        collector = make_collector(session)

        with self.assertRaises(CollectionError):
            collector.collect_posts_in_window("1h")


if __name__ == "__main__":
    unittest.main()
