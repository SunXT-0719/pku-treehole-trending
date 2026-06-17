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
        li.title = "点击复制 #" + p.pid;
        li.style.cursor = "pointer";
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
        li.addEventListener("click", function() {
            navigator.clipboard.writeText(String(p.pid)).catch(function() {
                var ta = document.createElement("textarea");
                ta.value = String(p.pid);
                ta.style.position = "fixed;left:-9999px";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
            });
            var orig = li.style.background;
            li.style.background = "#fff3e0";
            setTimeout(function() { li.style.background = orig; }, 300);
        });
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
