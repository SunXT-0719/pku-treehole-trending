"""PKU Treehole Trending — FastAPI backend."""

import time
import logging
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from config_private import USERNAME, PASSWORD
from collector import TreeholeCollector, WINDOWS
from trending import rank_posts, coarse_filter, COARSE_TOP_N

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="PKU Treehole Trending", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

collector = TreeholeCollector()

# Simple in-memory cache: {cache_key: (timestamp, data)}
_cache: dict = {}
CACHE_TTL = 30  # seconds


@app.on_event("startup")
async def startup():
    logger.info("Authenticating with Treehole...")
    if collector.ensure_auth(USERNAME, PASSWORD):
        logger.info("Treehole auth OK")
    else:
        logger.error("Treehole auth FAILED — check credentials and mobile token")


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    try:
        r = collector.client.session.get(
            "https://treehole.pku.edu.cn/api/mail/un_read", timeout=5
        )
        connected = r.status_code == 200
    except Exception:
        connected = False
    return {"status": "ok" if connected else "degraded", "treehole_connected": connected}


@app.get("/api/trending")
async def trending(
    window: str = Query("1d", description="Time window: 1h, 0.5d, 1d, 3d, 7d"),
    limit: int = Query(10, ge=1, le=50, description="Number of results"),
):
    """Get trending posts for the given time window.

    Two-stage algorithm:
    1. Coarse filter: likenum*2 + reply*3 → top 100
    2. Fine rank: U*5 + ln(reply+1)*3 + ln(likenum+1)*2
       with time bonus 5.0 * max(0, 1 - t_hours) for posts < 1 hour old
    """
    if window not in WINDOWS:
        return {"error": f"Invalid window. Choose from: {list(WINDOWS.keys())}"}

    # Check cache
    cache_key = f"{window}_{limit}"
    if cache_key in _cache:
        cached_at, cached_data = _cache[cache_key]
        if time.time() - cached_at < CACHE_TTL:
            return cached_data

    now_ts = time.time()
    logger.info("trending request: window=%s limit=%d", window, limit)

    # Step 1: Collect all posts in time window
    posts = collector.collect_posts_in_window(window)
    if not posts:
        return {
            "window": window,
            "generated_at": int(now_ts),
            "posts": [],
            "count": 0,
        }

    # Step 2: Coarse filter to top 100
    candidates = coarse_filter(posts, top_n=COARSE_TOP_N)

    # Step 3: Fetch unique commenter counts for candidates
    pids = [p["pid"] for p in candidates]
    logger.info("fetching unique commenters for %d candidates", len(pids))
    unique_map = collector.fetch_all_commenters(pids)

    # Step 4: Fine ranking
    results = rank_posts(posts, unique_map, now_ts, top_n=limit)

    response = {
        "window": window,
        "generated_at": int(now_ts),
        "posts": results,
        "count": len(results),
    }

    # Save to cache
    _cache[cache_key] = (time.time(), response)

    return response


if __name__ == "__main__":
    import uvicorn
    logger.info("Starting server on http://0.0.0.0:8765")
    uvicorn.run(app, host="0.0.0.0", port=8765)
