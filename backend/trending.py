"""PKU Treehole trending algorithm — two-stage ranking."""

import math
from typing import List, Dict, Any


# === Algorithm parameters (user-modified) ===
W_L_COARSE = 2      # likenum weight in coarse filter
W_R_COARSE = 3      # reply weight in coarse filter
COARSE_TOP_N = 100  # keep top N after coarse filter

W_U = 5             # unique commenters weight
W_C = 3             # comment total weight (power-scaled)
W_L = 5             # likenum weight (power-scaled, same as U)
POW = 0.7           # power exponent for reply/likenum (milder than ln)
B = 0.75            # max time bonus multiplier
T_CUTOFF = 1.0      # time bonus cutoff (hours)


def coarse_score(post: Dict[str, Any]) -> float:
    """Stage 1: simple weighted sum for filtering."""
    likenum = post.get("likenum", 0) or 0
    reply = post.get("reply", 0) or 0
    return likenum * W_L_COARSE + reply * W_R_COARSE


def coarse_filter(posts: List[Dict[str, Any]], top_n: int = COARSE_TOP_N) -> List[Dict[str, Any]]:
    """Filter posts to top N by coarse score."""
    scored = [(p, coarse_score(p)) for p in posts]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [p for p, _ in scored[:top_n]]


def fine_score(post: Dict[str, Any], unique_commenters: int, now_ts: float) -> float:
    """Stage 2: refined score with commenter diversity and time bonus.

    base_score = U*5 + reply^0.7*3 + likenum^0.7*5
    bonus(t) = B * max(0, 1 - t)   where t = hours since posting
    final_score = base_score * (1 + bonus(t))
    """
    likenum = post.get("likenum", 0) or 0
    reply = post.get("reply", 0) or 0
    u = unique_commenters

    base = (
        u * W_U
        + (reply ** POW) * W_C
        + (likenum ** POW) * W_L
    )

    post_ts = post.get("timestamp") or now_ts
    t = max(0.0, (now_ts - post_ts) / 3600.0)  # hours elapsed
    bonus = B * max(0.0, 1.0 - t)

    return base * (1.0 + bonus)


def rank_posts(
    posts: List[Dict[str, Any]],
    unique_commenters_map: Dict[int, int],
    now_ts: float,
    top_n: int = 10,
) -> List[Dict[str, Any]]:
    """Full two-stage ranking: coarse filter → fine rank.

    Args:
        posts: list of post dicts from list API
        unique_commenters_map: {pid: unique_commenter_count}
        now_ts: current unix timestamp
        top_n: number of results to return

    Returns:
        top N posts sorted by final_score, each augmented with score fields
    """
    # Stage 1: coarse filter to top 100
    candidates = coarse_filter(posts, top_n=COARSE_TOP_N)

    # Stage 2: fine scoring
    results = []
    for p in candidates:
        pid = p["pid"]
        u = unique_commenters_map.get(pid, 0)
        score = fine_score(p, u, now_ts)
        results.append({
            "pid": pid,
            "text": p.get("text", ""),
            "timestamp": p.get("timestamp", 0),
            "likenum": p.get("likenum", 0) or 0,
            "reply": p.get("reply", 0) or 0,
            "unique_commenters": u,
            "final_score": round(score, 2),
        })

    # Sort by final_score descending
    results.sort(key=lambda x: x["final_score"], reverse=True)

    # Assign ranks
    for i, r in enumerate(results[:top_n]):
        r["rank"] = i + 1

    return results[:top_n]
