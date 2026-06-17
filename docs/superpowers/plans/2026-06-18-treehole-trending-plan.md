# PKU Treehole 热帖追踪 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现从北大树洞实时追踪热帖的 Web 应用 + Edge 插件，两阶段算法排序，支持 5 个时间窗口。

**Architecture:** Python FastAPI 后端直接调用 Treehole API 采集数据并计算热度，提供 REST API；单个 HTML 页面同时作为独立 Web 前端和 Edge 插件 popup；插件额外包含 content script 注入侧边栏。

**Tech Stack:** Python 3, FastAPI, uvicorn, requests, HTML/CSS/vanilla JS

**算法参数 (用户修改):** coarse_score = likenum×2 + reply×3, bonus(t) = 5.0×max(0,1-t)

---

### Task 1: 项目骨架和配置

**Files:**
- Create: `backend/config_private.py`
- Create: `backend/requirements.txt`
- Create: `.gitignore`

- [ ] **Step 1: 创建目录结构并复制 client.py**

```bash
mkdir -p /Users/sunxt/projects/pku-treehole-trending/backend
cp /Users/sunxt/projects/pku-treehole-search-agent/client.py /Users/sunxt/projects/pku-treehole-trending/backend/client.py
```

Verify: `python3 -c "import sys; sys.path.insert(0,'backend'); from client import TreeholeClient; print('OK')"`

- [ ] **Step 2: 复制 config_private.py**

```bash
cp /Users/sunxt/projects/pku-treehole-search-agent/config_private.py /Users/sunxt/projects/pku-treehole-trending/backend/config_private.py
```

- [ ] **Step 3: 创建 requirements.txt**

写入 `backend/requirements.txt`：

```
fastapi>=0.115.0
uvicorn>=0.30.0
requests>=2.32.0
```

- [ ] **Step 4: 创建 .gitignore**

写入 `.gitignore`：

```
__pycache__/
*.pyc
backend/config_private.py
.venv/
*.egg-info/
data/
node_modules/
explore_api.py
```

- [ ] **Step 5: 安装依赖并验证**

```bash
cd /Users/sunxt/projects/pku-treehole-trending && pip3 install -r backend/requirements.txt
cd backend && python3 -c "from client import TreeholeClient; print('OK')"
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
cd /Users/sunxt/projects/pku-treehole-trending && git init && git add -A && git commit -m "feat: project skeleton with treehole client"
```

---

### Task 2: 热度算法模块 (trending.py)

**Files:**
- Create: `backend/trending.py`

- [ ] **Step 1: 实现两阶段热度计算函数**

写入 `backend/trending.py`：

```python
"""PKU Treehole trending algorithm — two-stage ranking."""

import math
from typing import List, Dict, Any


# === Algorithm parameters (user-modified) ===
W_L_COARSE = 2      # likenum weight in coarse filter
W_R_COARSE = 3      # reply weight in coarse filter
COARSE_TOP_N = 100  # keep top N after coarse filter

W_U = 5             # unique commenters weight
W_C = 3             # comment total weight (ln-scaled)
W_L = 2             # likenum weight (ln-scaled)
B = 5.0             # max time bonus multiplier
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

    base_score = U*5 + ln(reply+1)*3 + ln(likenum+1)*2
    bonus(t) = 5.0 * max(0, 1 - t)   where t = hours since posting
    final_score = base_score * (1 + bonus(t))
    """
    likenum = post.get("likenum", 0) or 0
    reply = post.get("reply", 0) or 0
    u = unique_commenters

    base = (
        u * W_U
        + math.log(reply + 1) * W_C
        + math.log(likenum + 1) * W_L
    )

    post_ts = post.get("timestamp", now_ts)
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
```

- [ ] **Step 2: 验证模块可导入**

```bash
cd /Users/sunxt/projects/pku-treehole-trending/backend && python3 -c "from trending import coarse_score, fine_score, rank_posts; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/sunxt/projects/pku-treehole-trending && git add backend/trending.py && git commit -m "feat: two-stage trending algorithm with time bonus"
```

---

### Task 3: 数据采集器 (collector.py)

**Files:**
- Create: `backend/collector.py`

- [ ] **Step 1: 实现采集器**

写入 `backend/collector.py`：

```python
"""Treehole data collector — paginates list API, fetches comment data."""

import time
import logging
from typing import List, Dict, Any

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
LIST_DELAY = 0.3          # seconds between list API calls
COMMENT_DELAY = 0.2       # seconds between comment API calls


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

                # Check if oldest post on this page is before cutoff
                oldest_ts = min(p.get("timestamp", 0) for p in posts)
                if oldest_ts < cutoff_ts:
                    break

                page += 1
                time.sleep(LIST_DELAY)

            except Exception as e:
                logger.error("list API exception on page %d: %s", page, e)
                break

        # Filter to posts strictly within the time window
        filtered = [p for p in all_posts if p.get("timestamp", 0) >= cutoff_ts]
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

            comments = data["data"]["data"]
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
        """Fetch unique commenter counts for multiple posts.

        Args:
            pids: list of post IDs

        Returns:
            {pid: unique_commenter_count}
        """
        result = {}
        for pid in pids:
            result[pid] = self.fetch_unique_commenters(pid)
            time.sleep(COMMENT_DELAY)
        return result
```

- [ ] **Step 2: 验证模块可导入**

```bash
cd /Users/sunxt/projects/pku-treehole-trending/backend && python3 -c "from collector import TreeholeCollector, WINDOWS; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/sunxt/projects/pku-treehole-trending && git add backend/collector.py && git commit -m "feat: treehole data collector with pagination and commenter fetch"
```

---

### Task 4: FastAPI 后端入口 (main.py)

**Files:**
- Create: `backend/main.py`

- [ ] **Step 1: 实现 FastAPI 应用**

写入 `backend/main.py`：

```python
"""PKU Treehole Trending — FastAPI backend."""

import time
import logging
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from config_private import USERNAME, PASSWORD
from collector import TreeholeCollector, WINDOWS
from trending import rank_posts

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
    from trending import coarse_filter, COARSE_TOP_N
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
```

- [ ] **Step 2: 启动后端并测试健康检查**

```bash
cd /Users/sunxt/projects/pku-treehole-trending/backend && python3 main.py &
sleep 3
curl -s http://localhost:8765/api/health | python3 -m json.tool
```

Expected: `{"status": "ok", "treehole_connected": true}`

- [ ] **Step 3: 测试 trending 接口 (1h 窗口)**

```bash
curl -s "http://localhost:8765/api/trending?window=1h&limit=5" | python3 -m json.tool
```

Expected: JSON 响应包含 `posts` 数组和 `count` 字段。

- [ ] **Step 4: 停止后端并 Commit**

```bash
kill %1 2>/dev/null
cd /Users/sunxt/projects/pku-treehole-trending && git add backend/main.py && git commit -m "feat: FastAPI backend with trending endpoint"
```

---

### Task 5: Web 前端页面

**Files:**
- Create: `frontend/index.html`
- Create: `frontend/style.css`
- Create: `frontend/app.js`

- [ ] **Step 1: 创建 HTML 骨架**

写入 `frontend/index.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>树洞热帖追踪</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>&#x1f525; 树洞热帖追踪</h1>
        </header>

        <nav class="window-tabs">
            <button data-window="1h">1小时</button>
            <button data-window="0.5d">半天</button>
            <button data-window="1d" class="active">1天</button>
            <button data-window="3d">3天</button>
            <button data-window="7d">1周</button>
        </nav>

        <div id="status" class="status loading">
            <span class="spinner"></span>
            <span id="status-text">正在加载...</span>
        </div>

        <ol id="post-list" class="post-list"></ol>

        <footer>
            <span id="generated-at"></span>
        </footer>
    </div>

    <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 创建 CSS 样式**

写入 `frontend/style.css`：

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f5f5f5;
    color: #333;
    min-width: 360px;
    max-width: 600px;
    margin: 0 auto;
    padding: 16px;
}

.container {
    background: #fff;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

header { text-align: center; margin-bottom: 16px; }
header h1 { font-size: 20px; color: #e65100; }

.window-tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 16px;
    overflow-x: auto;
}
.window-tabs button {
    flex: 1;
    padding: 8px 6px;
    border: 1px solid #ddd;
    background: #fff;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    white-space: nowrap;
    transition: all 0.15s;
}
.window-tabs button.active {
    background: #e65100;
    color: #fff;
    border-color: #e65100;
}

.status {
    text-align: center;
    padding: 20px;
    color: #888;
    font-size: 14px;
}
.status.error { color: #d32f2f; }
.status.loading .spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid #ddd;
    border-top-color: #e65100;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    margin-right: 6px;
    vertical-align: middle;
}
@keyframes spin { to { transform: rotate(360deg); } }

.post-list { list-style: none; }

.post-item {
    padding: 12px;
    border-bottom: 1px solid #f0f0f0;
    transition: background 0.1s;
}
.post-item:hover { background: #fff8f0; }

.post-rank {
    display: inline-block;
    width: 24px;
    height: 24px;
    line-height: 24px;
    text-align: center;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    margin-right: 8px;
    background: #f0f0f0;
    color: #666;
}
.post-item:nth-child(1) .post-rank { background: #ff6d00; color: #fff; }
.post-item:nth-child(2) .post-rank { background: #ff9100; color: #fff; }
.post-item:nth-child(3) .post-rank { background: #ffab40; color: #fff; }

.post-meta {
    display: flex;
    gap: 10px;
    font-size: 12px;
    color: #888;
    margin-top: 4px;
}
.post-meta span {
    display: flex;
    align-items: center;
    gap: 2px;
}
.post-score { font-weight: 700; color: #e65100; }

.post-text {
    font-size: 14px;
    line-height: 1.5;
    margin-top: 6px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: #555;
}

.post-time { font-size: 11px; color: #aaa; margin-top: 4px; }

footer { text-align: center; font-size: 11px; color: #bbb; margin-top: 12px; }
```

- [ ] **Step 3: 创建 JavaScript 逻辑**

写入 `frontend/app.js`：

```javascript
var API_BASE = "http://localhost:8765";

var state = { window: "1d", limit: 10 };

var statusEl = document.getElementById("status");
var statusText = document.getElementById("status-text");
var postList = document.getElementById("post-list");
var generatedAt = document.getElementById("generated-at");
var tabButtons = document.querySelectorAll(".window-tabs button");

function setStatus(type, text) {
    statusEl.className = "status " + type;
    statusText.textContent = text;
    if (type !== "loading") {
        var spinner = statusEl.querySelector(".spinner");
        if (spinner) spinner.remove();
    }
}

function timeAgo(ts) {
    var seconds = Math.floor(Date.now() / 1000) - ts;
    if (seconds < 60) return "刚刚";
    var mins = Math.floor(seconds / 60);
    if (mins < 60) return mins + "分钟前";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "小时前";
    var days = Math.floor(hours / 24);
    return days + "天前";
}

function renderPosts(posts) {
    postList.innerHTML = "";
    if (!posts.length) {
        setStatus("", "该时间窗口暂无帖子");
        return;
    }
    statusEl.style.display = "none";
    posts.forEach(function(p) {
        var li = document.createElement("li");
        li.className = "post-item";
        li.innerHTML =
            '<div><span class="post-rank">' + p.rank + '</span>' +
            '<span class="post-score">' + p.final_score + ' 分</span></div>' +
            '<div class="post-meta">' +
            '<span>&#x2b50; ' + p.likenum + '</span>' +
            '<span>&#x1f4ac; ' + p.reply + '</span>' +
            '<span>&#x1f465; ' + p.unique_commenters + '</span>' +
            '</div>' +
            '<div class="post-text">' + escapeHtml(p.text) + '</div>' +
            '<div class="post-time">#' + p.pid + ' &middot; ' + timeAgo(p.timestamp) + '</div>';
        postList.appendChild(li);
    });
}

function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function fetchTrending() {
    setStatus("loading", "正在加载...");
    statusEl.style.display = "";

    var url = API_BASE + "/api/trending?window=" + state.window + "&limit=" + state.limit;
    fetch(url)
        .then(function(resp) {
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            return resp.json();
        })
        .then(function(data) {
            if (data.error) {
                setStatus("error", data.error);
                return;
            }
            renderPosts(data.posts);
            if (data.generated_at) {
                generatedAt.textContent = "更新于 " + new Date(data.generated_at * 1000).toLocaleString("zh-CN");
            }
        })
        .catch(function(err) {
            setStatus("error", "连接失败，请确认后端已启动 (localhost:8765)");
            console.error(err);
        });
}

tabButtons.forEach(function(btn) {
    btn.addEventListener("click", function() {
        tabButtons.forEach(function(b) { b.classList.remove("active"); });
        btn.classList.add("active");
        state.window = btn.dataset.window;
        fetchTrending();
    });
});

fetchTrending();
```

- [ ] **Step 4: 验证前端文件存在**

```bash
ls -la /Users/sunxt/projects/pku-treehole-trending/frontend/
```

Expected: `index.html`, `style.css`, `app.js`

- [ ] **Step 5: Commit**

```bash
cd /Users/sunxt/projects/pku-treehole-trending && git add frontend/ && git commit -m "feat: web frontend with ranking UI and time window selector"
```

---

### Task 6: Edge 浏览器插件

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/popup.html`
- Create: `extension/sidebar.js`

- [ ] **Step 1: 创建 manifest.json**

写入 `extension/manifest.json`：

```json
{
    "manifest_version": 3,
    "name": "树洞热帖追踪",
    "version": "0.1.0",
    "description": "追踪北京大学树洞实时热帖排行",
    "permissions": ["storage"],
    "host_permissions": ["http://localhost:8765/*"],
    "action": {
        "default_popup": "popup.html",
        "default_title": "树洞热帖"
    },
    "content_scripts": [
        {
            "matches": ["https://treehole.pku.edu.cn/*"],
            "js": ["sidebar.js"]
        }
    ]
}
```

- [ ] **Step 2: 创建 popup.html**

写入 `extension/popup.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>树洞热帖</title>
    <link rel="stylesheet" href="../frontend/style.css">
    <style>
        body { padding: 0; min-width: 380px; }
        .container { box-shadow: none; border-radius: 0; }
    </style>
</head>
<body>
    <div class="container">
        <header><h1>&#x1f525; 树洞热帖追踪</h1></header>
        <nav class="window-tabs">
            <button data-window="1h">1小时</button>
            <button data-window="0.5d">半天</button>
            <button data-window="1d" class="active">1天</button>
            <button data-window="3d">3天</button>
            <button data-window="7d">1周</button>
        </nav>
        <div id="status" class="status loading">
            <span class="spinner"></span>
            <span id="status-text">正在加载...</span>
        </div>
        <ol id="post-list" class="post-list"></ol>
        <footer><span id="generated-at"></span></footer>
    </div>
    <script src="../frontend/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: 创建 sidebar.js（注入树洞页面侧边栏）**

写入 `extension/sidebar.js`：

```javascript
(function() {
    "use strict";

    var API_BASE = "http://localhost:8765";

    var sidebar = document.createElement("div");
    sidebar.id = "trending-sidebar";
    sidebar.innerHTML =
        '<div class="trending-header">' +
        '<h3>&#x1f525; 热帖</h3>' +
        '<select class="trending-window">' +
        '<option value="1h">1小时</option>' +
        '<option value="0.5d">半天</option>' +
        '<option value="1d" selected>1天</option>' +
        '<option value="3d">3天</option>' +
        '<option value="7d">1周</option>' +
        '</select>' +
        '</div>' +
        '<div class="trending-list"></div>';

    var style = document.createElement("style");
    style.textContent =
        "#trending-sidebar {" +
        "position:fixed;right:0;top:0;width:320px;height:100vh;" +
        "background:#fff;box-shadow:-2px 0 12px rgba(0,0,0,0.1);" +
        "z-index:99999;overflow-y:auto;padding:16px;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;" +
        "}" +
        ".trending-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}" +
        ".trending-header h3{margin:0;color:#e65100;}" +
        ".trending-window{padding:4px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;}" +
        ".trending-item{padding:10px 0;border-bottom:1px solid #f0f0f0;}" +
        ".trending-item .rank{font-weight:700;color:#e65100;}" +
        ".trending-item .meta{font-size:11px;color:#888;margin:2px 0;}" +
        ".trending-item .text{font-size:13px;color:#444;margin-top:4px;line-height:1.4;}" +
        ".trending-loading{color:#888;text-align:center;padding:20px;}";

    document.head.appendChild(style);
    document.body.appendChild(sidebar);

    var list = sidebar.querySelector(".trending-list");
    var select = sidebar.querySelector(".trending-window");

    function escapeHtml(s) {
        var div = document.createElement("div");
        div.textContent = s;
        return div.innerHTML;
    }

    function load(window) {
        list.innerHTML = '<div class="trending-loading">加载中...</div>';
        fetch(API_BASE + "/api/trending?window=" + window + "&limit=10")
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.posts || !data.posts.length) {
                    list.innerHTML = '<div class="trending-loading">暂无热帖</div>';
                    return;
                }
                list.innerHTML = data.posts.map(function(p) {
                    return '<div class="trending-item">' +
                        '<span class="rank">#' + p.rank + '</span> ' +
                        '<span style="color:#e65100;font-weight:700">' + p.final_score + '分</span>' +
                        '<div class="meta">&#x2b50;' + p.likenum + ' &#x1f4ac;' + p.reply + ' &#x1f465;' + p.unique_commenters + '</div>' +
                        '<div class="text">' + escapeHtml(p.text || "").substring(0, 120) + '</div>' +
                        '</div>';
                }).join("");
            })
            .catch(function() {
                list.innerHTML = '<div class="trending-loading" style="color:#d32f2f">连接后端失败</div>';
            });
    }

    select.addEventListener("change", function() { load(select.value); });
    load("1d");
})();
```

- [ ] **Step 4: 验证插件文件完整**

```bash
ls -la /Users/sunxt/projects/pku-treehole-trending/extension/
```

Expected: `manifest.json`, `popup.html`, `sidebar.js`

- [ ] **Step 5: Commit**

```bash
cd /Users/sunxt/projects/pku-treehole-trending && git add extension/ && git commit -m "feat: Edge extension with popup and sidebar injection"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 启动后端并执行完整测试**

```bash
cd /Users/sunxt/projects/pku-treehole-trending/backend && python3 main.py &
sleep 3
```

另开终端测试：

```bash
# Health check
echo "=== Health ==="
curl -s http://localhost:8765/api/health | python3 -m json.tool

# Test 1h window (fastest)
echo "=== 1h window ==="
curl -s "http://localhost:8765/api/trending?window=1h&limit=5" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'count={d[\"count\"]}, window={d[\"window\"]}')
for p in d['posts'][:5]:
    print(f'  #{p[\"rank\"]} pid={p[\"pid\"]} score={p[\"final_score\"]} U={p[\"unique_commenters\"]} likes={p[\"likenum\"]} reply={p[\"reply\"]}')
"

# Test 1d window
echo "=== 1d window ==="
curl -s "http://localhost:8765/api/trending?window=1d&limit=3" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'count={d[\"count\"]}')
for p in d['posts'][:3]:
    print(f'  #{p[\"rank\"]} pid={p[\"pid\"]} score={p[\"final_score\"]} U={p[\"unique_commenters\"]}')
"
```

- [ ] **Step 2: 在浏览器中打开前端页面**

```
file:///Users/sunxt/projects/pku-treehole-trending/frontend/index.html
```

确认页面正常加载、可切换时间窗口、帖子列表正确渲染。

- [ ] **Step 3: 安装 Edge 插件并验证**

1. Edge → `edge://extensions/` → 开发人员模式
2. 加载解压缩 → 选择 `extension/` 目录
3. 打开 `https://treehole.pku.edu.cn` → 确认右侧侧边栏显示热帖
4. 点击插件图标 → 确认 popup 弹窗显示热帖

- [ ] **Step 4: 修复问题并最终提交**

```bash
kill %1 2>/dev/null
cd /Users/sunxt/projects/pku-treehole-trending && git add -A && git commit -m "chore: end-to-end verification and final adjustments"
```
