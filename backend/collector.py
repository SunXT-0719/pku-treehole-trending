"""Treehole data collector — paginates list API, fetches comment data."""

import time
import logging
from typing import List, Dict, Any
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

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


class TreeholeCollector:
    """Collects posts from Treehole and enriches with comment data."""

    def __init__(self):
        self.client = TreeholeClient()

    def ensure_auth(self, username: str, password: str) -> bool:
        """Ensure the client is authenticated."""
        return self.client.ensure_login(username, password, interactive=False)

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
                r = self.client.session.get(url, params=params, timeout=15)
                data = r.json()

                if data.get("code") != 20000:
                    logger.error("list API error on page %d: %s", page, data.get("message"))
                    break

                posts = data["data"]["list"]
                if not posts:
                    break

                all_posts.extend(posts)

                # Check if oldest valid post on this page is before cutoff
                # Filter out posts with missing/null timestamps to avoid 0 breaking min()
                valid_ts = [(p.get("timestamp") or 0) for p in posts if (p.get("timestamp") or 0) > 0]
                if not valid_ts:
                    page += 1
                    continue
                oldest_ts = min(valid_ts)
                if oldest_ts < cutoff_ts:
                    break

                page += 1
                # Safety: prevent infinite pagination
                if page > MAX_PAGES:
                    logger.warning("collect_posts: reached MAX_PAGES=%d, stopping", MAX_PAGES)
                    break
                time.sleep(LIST_DELAY)

            except Exception as e:
                logger.error("list API exception on page %d: %s", page, e)
                break

        # Filter to posts strictly within the time window
        filtered = [p for p in all_posts if (p.get("timestamp") or 0) >= cutoff_ts]
        logger.info("collect_posts: window=%s, pages=%d, collected=%d, filtered=%d",
                     window, page, len(all_posts), len(filtered))
        return filtered

    def fetch_unique_commenters(self, pid: int) -> int:
        """Fetch unique commenter count for a single post.

        Counts distinct 'name' values in the comment list.
        Returns 0 if the post has no comments or an error occurs.
        """
        try:
            url = f"https://treehole.pku.edu.cn/api/pku_comment_v3/{pid}"
            r = self.client.session.get(url, params={"page": 1, "limit": 100}, timeout=10)
            data = r.json()

            if data.get("code") != 20000:
                return 0

            comment_data = data.get("data")
            if not comment_data:
                return 0
            comments = comment_data.get("data") or []
            if not comments:
                return 0

            names = set()
            for c in comments:
                name = c.get("name", "")
                if name:
                    names.add(name)

            return len(names)

        except Exception as e:
            logger.warning("fetch_unique_commenters for pid %d: %s", pid, e)
            return 0

    def fetch_all_commenters(self, pids: List[int]) -> Dict[int, int]:
        """Fetch unique commenter counts for multiple posts in parallel.

        Args:
            pids: list of post IDs

        Returns:
            {pid: unique_commenter_count}
        """
        if not pids:
            return {}

        # Extract auth header from the client session for thread-safe reuse
        auth_header = self.client.session.headers.get("authorization", "")

        def _fetch_one(pid: int) -> tuple:
            """Fetch commenter count for one post. Returns (pid, count)."""
            try:
                url = f"https://treehole.pku.edu.cn/api/pku_comment_v3/{pid}"
                headers = {"authorization": auth_header, "user-agent": self.client.session.headers.get("user-agent", "")}
                r = requests.get(url, params={"page": 1, "limit": 100}, headers=headers, timeout=10)
                data = r.json()

                if data.get("code") != 20000:
                    return (pid, 0)

                comment_data = data.get("data")
                if not comment_data:
                    return (pid, 0)
                comments = comment_data.get("data") or []
                if not comments:
                    return (pid, 0)

                names = set()
                for c in comments:
                    name = c.get("name", "")
                    if name:
                        names.add(name)
                return (pid, len(names))

            except Exception as e:
                logger.warning("fetch_unique_commenters for pid %d: %s", pid, e)
                return (pid, 0)

        result = {}
        with ThreadPoolExecutor(max_workers=COMMENT_FETCH_WORKERS) as executor:
            futures = {executor.submit(_fetch_one, pid): pid for pid in pids}
            for future in as_completed(futures):
                pid, count = future.result()
                result[pid] = count

        logger.info("fetch_all_commenters: %d posts in parallel (workers=%d)",
                     len(pids), COMMENT_FETCH_WORKERS)
        return result
