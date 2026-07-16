"""PKU Treehole Trending — FastAPI backend."""

import time
import logging
import threading
from typing import Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from config_private import USERNAME, PASSWORD
from collector import TreeholeCollector, WINDOWS, CollectionError
from trending import rank_posts, coarse_filter, COARSE_TOP_N

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="PKU Treehole Trending", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "null",
        "http://localhost:8765",
        "http://127.0.0.1:8765",
        # The injected sidebar runs with the Treehole page's origin.
        "https://treehole.pku.edu.cn",
    ],
    allow_origin_regex=r"^(chrome-extension|moz-extension)://[a-zA-Z0-9-]+$",
    allow_methods=["GET"],
    allow_headers=["Content-Type"],
)

collector = TreeholeCollector()

# Simple in-memory cache: {cache_key: (timestamp, data)}
_cache: dict = {}
_window_locks = {window: threading.Lock() for window in WINDOWS}
CACHE_TTL = 30  # seconds (default fallback)

# Window-dependent response cache TTL: smaller windows need fresher data
_RESPONSE_CACHE_TTL = {
    "1h": 15,
    "0.5d": 30,
    "1d": 60,
    "3d": 120,
    "7d": 300,
}


@app.on_event("startup")
async def startup():
    logger.info("Authenticating with Treehole...")
    if collector.ensure_auth(USERNAME, PASSWORD):
        logger.info("Treehole auth OK")
    else:
        logger.error("Treehole auth FAILED — check credentials and mobile token")


@app.get("/api/health")
def health():
    """Health check endpoint."""
    try:
        r = collector.client.session.get(
            "https://treehole.pku.edu.cn/api/mail/un_read", timeout=5
        )
        connected = r.status_code == 200 and bool(r.json().get("success"))
    except Exception:
        connected = False
    return {"status": "ok" if connected else "degraded", "treehole_connected": connected}


@app.get("/api/trending")
def trending(
    window: str = Query("1d", description="Time window: 1h, 0.5d, 1d, 3d, 7d"),
    limit: int = Query(10, ge=1, le=50, description="Number of results"),
):
    """Get trending posts for the given time window.

    Two-stage algorithm:
    1. Coarse filter: likenum*2 + reply*3 → top 100
    2. Fine rank: U*5 + reply^0.7*3 + likenum^0.7*5
       with a linearly decreasing 0.75x bonus for posts less than 1 hour old
    """
    if window not in WINDOWS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid window. Choose from: {list(WINDOWS.keys())}",
        )

    # Cache a full Top 50 once per window; smaller limits are cheap slices.
    cache_key = window
    cache_ttl = _RESPONSE_CACHE_TTL.get(window, CACHE_TTL)
    if cache_key in _cache:
        cached_at, cached_data = _cache[cache_key]
        if time.time() - cached_at < cache_ttl:
            return _slice_response(cached_data, limit, cached=True)

    with _window_locks[window]:
        # A concurrent request may have filled the cache while we waited.
        if cache_key in _cache:
            cached_at, cached_data = _cache[cache_key]
            if time.time() - cached_at < cache_ttl:
                return _slice_response(cached_data, limit, cached=True)

        now_ts = time.time()
        logger.info("trending request: window=%s limit=%d", window, limit)

        try:
            posts = collector.collect_posts_in_window(window)
            if not posts:
                response = {
                    "window": window,
                    "generated_at": int(now_ts),
                    "posts": [],
                }
            else:
                pids = [p["pid"] for p in coarse_filter(posts, top_n=COARSE_TOP_N)]
                logger.info("fetching unique commenters for %d candidates", len(pids))
                unique_map = collector.fetch_all_commenters(pids)
                results = rank_posts(posts, unique_map, now_ts, top_n=50)
                response = {
                    "window": window,
                    "generated_at": int(now_ts),
                    "posts": results,
                }
        except CollectionError as exc:
            logger.error("trending collection failed: %s", exc)
            if cache_key in _cache:
                _, stale_data = _cache[cache_key]
                return _slice_response(
                    stale_data,
                    limit,
                    cached=True,
                    stale=True,
                    warning="上游更新失败，当前展示上次成功结果",
                )
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        _cache[cache_key] = (time.time(), response)
        return _slice_response(response, limit, cached=False)


def _slice_response(
    data: dict,
    limit: int,
    *,
    cached: bool,
    stale: bool = False,
    warning: Optional[str] = None,
) -> dict:
    posts = data.get("posts", [])[:limit]
    response = {
        "window": data["window"],
        "generated_at": data["generated_at"],
        "posts": posts,
        "count": len(posts),
        "cached": cached,
        "stale": stale,
    }
    if warning:
        response["warning"] = warning
    return response


if __name__ == "__main__":
    import uvicorn
    logger.info("Starting server on http://127.0.0.1:8765")
    uvicorn.run(app, host="127.0.0.1", port=8765)
