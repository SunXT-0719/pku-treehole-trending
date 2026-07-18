"""Treehole data collector — paginates list API, fetches comment data."""

import time
import logging
import threading
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from client import TreeholeClient

logger = logging.getLogger(__name__)

# Time window definitions (in seconds)
WINDOWS = {
    "1h": 3600,
    "0.5d": 43200,
    "1d": 86400,
    "3d": 259200,
    "7d": 604800,
}

LIST_PAGE_SIZE = 100      # max posts per page
MAX_PAGES = 1000          # safety limit to prevent infinite loop
LIST_DELAY = 0.1          # seconds between list API calls
COMMENT_FETCH_WORKERS = 8 # parallel threads for comment fetching
COMMENT_PAGE_SIZE = 100
MAX_COMMENT_PAGES = 100


class CollectionError(RuntimeError):
    """Raised when upstream data could not be collected completely."""


class AuthenticationError(CollectionError):
    """Raised when an expired Treehole login cannot be refreshed automatically."""


class TreeholeCollector:
    """Collects posts from Treehole and enriches with comment data.

    Commenter counts are cached for five minutes. List pages are deliberately
    not cached by page number: new posts continuously shift page boundaries,
    so combining fresh and cached pages can silently omit posts.
    """

    COMMENTER_CACHE_TTL = 300  # 5 minutes

    def __init__(self):
        self.client = TreeholeClient()
        self._commenter_cache: Dict[int, tuple] = {}
        self._thread_local = threading.local()
        self._auth_lock = threading.Lock()
        self._auth_version = 0
        self._username: Optional[str] = None
        self._password: Optional[str] = None

    def _sync_session_auth(self, session: requests.Session) -> None:
        """Copy the latest central authentication state into a worker session."""
        session.headers.update(self.client.session.headers)
        session.cookies.update(self.client.session.cookies)

    def _worker_session(self) -> requests.Session:
        """Return one pooled HTTP session per comment-fetch worker thread."""
        session = getattr(self._thread_local, "session", None)
        if session is None:
            session = requests.Session()
            retry = Retry(
                total=2,
                connect=2,
                read=2,
                status=2,
                backoff_factor=0.25,
                status_forcelist=(429, 500, 502, 503, 504),
                allowed_methods=frozenset({"GET"}),
                respect_retry_after_header=True,
            )
            adapter = HTTPAdapter(
                max_retries=retry,
                pool_connections=COMMENT_FETCH_WORKERS,
                pool_maxsize=COMMENT_FETCH_WORKERS,
            )
            session.mount("https://", adapter)
            self._sync_session_auth(session)
            self._thread_local.session = session
        else:
            # Authentication can be refreshed after workers were first created.
            self._sync_session_auth(session)
        return session

    def ensure_auth(self, username: str, password: str) -> bool:
        """Ensure the client is authenticated."""
        self._username = username
        self._password = password
        authenticated = self.client.ensure_login(
            username, password, interactive=False
        )
        if authenticated:
            self._auth_version += 1
        return authenticated

    def _refresh_auth(self, observed_version: int) -> None:
        """Refresh expired authentication once across all concurrent workers."""
        with self._auth_lock:
            # Another request refreshed the shared client while this one waited.
            if self._auth_version != observed_version:
                return

            if not self._username or not self._password:
                raise AuthenticationError(
                    "树洞登录已过期，且后端没有可用于自动刷新的账号配置"
                )

            logger.warning("Treehole authentication expired; refreshing login")
            try:
                authenticated = self.client.ensure_login(
                    self._username,
                    self._password,
                    interactive=False,
                )
            except Exception as exc:
                raise AuthenticationError(
                    "树洞登录已过期，自动刷新失败；请重新执行交互式登录完成手机令牌验证"
                ) from exc

            if not authenticated:
                raise AuthenticationError(
                    "树洞登录已过期，自动刷新需要手机令牌；请重新执行交互式登录后再启动后端"
                )

            self._auth_version += 1
            logger.info("Treehole authentication refreshed successfully")

    def _get_with_auth_retry(
        self,
        session: requests.Session,
        url: str,
        **kwargs: Any,
    ) -> requests.Response:
        """GET once, refresh shared login on 401, then retry exactly once."""
        observed_version = self._auth_version
        response = session.get(url, **kwargs)
        if response.status_code != 401:
            return response

        self._refresh_auth(observed_version)
        self._sync_session_auth(session)
        response = session.get(url, **kwargs)
        if response.status_code == 401:
            raise AuthenticationError(
                "树洞登录刷新后仍被拒绝；请重新执行交互式登录完成手机令牌验证"
            )
        return response

    def collect_posts_in_window(self, window: str) -> List[Dict[str, Any]]:
        """Collect all posts within the given time window.

        Paginates /chapi/api/v3/hole/list until timestamps exceed the window boundary.

        Args:
            window: one of '1h', '0.5d', '1d', '3d', '7d'

        Returns:
            list of post dicts within the time window
        """
        window_seconds = WINDOWS.get(window, WINDOWS["1d"])
        cutoff_ts = time.time() - window_seconds

        all_posts = []
        page = 1

        while True:
            try:
                url = "https://treehole.pku.edu.cn/chapi/api/v3/hole/list"
                params = {"page": page, "limit": LIST_PAGE_SIZE}
                r = self._get_with_auth_retry(
                    self.client.session,
                    url,
                    params=params,
                    timeout=15,
                )
                r.raise_for_status()
                data = r.json()

                if data.get("code") != 20000:
                    raise CollectionError(
                        f"list API error on page {page}: {data.get('message', 'unknown error')}"
                    )

                page_posts = (data.get("data") or {}).get("list") or []

                if not page_posts:
                    break

                all_posts.extend(page_posts)

                # Check if oldest valid post on this page is before cutoff
                # Filter out posts with missing/null timestamps to avoid 0 breaking min()
                valid_ts = [(p.get("timestamp") or 0) for p in page_posts if (p.get("timestamp") or 0) > 0]
                if not valid_ts:
                    page += 1
                    if page > MAX_PAGES:
                        raise CollectionError(
                            f"list pagination exceeded safety limit MAX_PAGES={MAX_PAGES}"
                        )
                    time.sleep(LIST_DELAY)
                    continue
                oldest_ts = min(valid_ts)
                if oldest_ts < cutoff_ts:
                    break

                page += 1
                # Safety: prevent infinite pagination
                if page > MAX_PAGES:
                    raise CollectionError(
                        f"list pagination exceeded safety limit MAX_PAGES={MAX_PAGES}"
                    )
                time.sleep(LIST_DELAY)

            except CollectionError:
                raise
            except Exception as e:
                raise CollectionError(f"list API exception on page {page}: {e}") from e

        # Filter to posts strictly within the time window
        # De-duplicate posts if feed movement made adjacent pages overlap.
        posts_by_pid = {p.get("pid"): p for p in all_posts if p.get("pid") is not None}
        filtered = [
            p for p in posts_by_pid.values()
            if (p.get("timestamp") or 0) >= cutoff_ts
        ]
        logger.info("collect_posts: window=%s, pages=%d, collected=%d, filtered=%d",
                     window, page, len(all_posts), len(filtered))
        return filtered

    @staticmethod
    def _positive_int(value: Any) -> Optional[int]:
        try:
            parsed = int(value)
            return parsed if parsed > 0 else None
        except (TypeError, ValueError):
            return None

    def _fetch_unique_commenters_with_session(
        self, session: requests.Session, pid: int
    ) -> int:
        """Fetch every comment page and count distinct non-empty names."""
        names = set()
        fetched_count = 0
        seen_page_signatures = set()

        for page in range(1, MAX_COMMENT_PAGES + 1):
            url = f"https://treehole.pku.edu.cn/api/pku_comment_v3/{pid}"
            r = self._get_with_auth_retry(
                session,
                url,
                params={"page": page, "limit": COMMENT_PAGE_SIZE, "sort": "asc"},
                timeout=10,
            )
            r.raise_for_status()
            data = r.json()

            if data.get("code") != 20000:
                raise CollectionError(
                    f"comment API error for pid {pid}: {data.get('message', 'unknown error')}"
                )

            comment_data = data.get("data") or {}
            comments = comment_data.get("data") or []
            if not comments:
                return len(names)

            signature = tuple(
                c.get("cid") or c.get("id") or (c.get("name"), c.get("timestamp"), c.get("text"))
                for c in comments
            )
            if signature in seen_page_signatures:
                raise CollectionError(f"comment pagination repeated for pid {pid} on page {page}")
            seen_page_signatures.add(signature)

            fetched_count += len(comments)
            names.update(c.get("name") for c in comments if c.get("name"))

            last_page = self._positive_int(
                comment_data.get("last_page") or comment_data.get("total_pages")
            )
            total = self._positive_int(
                comment_data.get("total")
                or comment_data.get("comment_total")
                or data.get("total")
            )
            if last_page is not None and page >= last_page:
                return len(names)
            if total is not None and fetched_count >= total:
                return len(names)
            if last_page is None and total is None and len(comments) < COMMENT_PAGE_SIZE:
                return len(names)

        raise CollectionError(f"comment pagination exceeded {MAX_COMMENT_PAGES} pages for pid {pid}")

    def fetch_unique_commenters(self, pid: int) -> int:
        """Fetch unique commenter count for a single post.

        Counts distinct 'name' values in the comment list.
        Returns 0 if the post has no comments. Raises CollectionError on failure.
        """
        return self._fetch_unique_commenters_with_session(self.client.session, pid)

    def fetch_all_commenters(self, pids: List[int]) -> Dict[int, int]:
        """Fetch unique commenter counts for multiple posts in parallel.

        Uses per-post cache (TTL 5 min) to avoid re-fetching the same post's
        comment data across repeated or overlapping requests.

        Args:
            pids: list of post IDs

        Returns:
            {pid: unique_commenter_count}
        """
        if not pids:
            return {}

        result = {}
        uncached_pids = []

        # Check cache first
        now = time.time()
        for pid in pids:
            cached = self._commenter_cache.get(pid)
            if cached:
                cached_ts, count = cached
                if now - cached_ts < self.COMMENTER_CACHE_TTL:
                    result[pid] = count
                    continue
            uncached_pids.append(pid)

        if uncached_pids:
            logger.info("fetch_all_commenters: %d cached, %d to fetch (workers=%d)",
                         len(pids) - len(uncached_pids), len(uncached_pids), COMMENT_FETCH_WORKERS)

            def _fetch_one(pid: int) -> tuple:
                """Fetch commenter count for one post. Returns (pid, count, error)."""
                try:
                    count = self._fetch_unique_commenters_with_session(
                        self._worker_session(), pid
                    )
                    return (pid, count, None)
                except Exception as e:
                    logger.warning("fetch_unique_commenters for pid %d: %s", pid, e)
                    return (pid, None, e)

            failures = []
            with ThreadPoolExecutor(max_workers=COMMENT_FETCH_WORKERS) as executor:
                futures = {executor.submit(_fetch_one, pid): pid for pid in uncached_pids}
                for future in as_completed(futures):
                    pid, count, error = future.result()
                    if error is not None:
                        failures.append((pid, error))
                        continue
                    self._commenter_cache[pid] = (time.time(), count)
                    result[pid] = count

            if failures:
                auth_failure = next(
                    (error for _, error in failures if isinstance(error, AuthenticationError)),
                    None,
                )
                if auth_failure is not None:
                    raise auth_failure
                sample = ", ".join(f"{pid}: {error}" for pid, error in failures[:3])
                raise CollectionError(
                    f"failed to fetch comments for {len(failures)} posts ({sample})"
                )
        else:
            logger.info("fetch_all_commenters: all %d posts from cache", len(pids))

        return result
