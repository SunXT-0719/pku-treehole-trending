"use strict";

var API_BASE = "http://localhost:8765";
var REQUEST_PROFILES = {
    "1h":   { timeout: 60000,  hint: "正在获取热帖…" },
    "0.5d": { timeout: 120000, hint: "正在回溯半天数据，首次计算可能需要约 30 秒…" },
    "1d":   { timeout: 180000, hint: "正在回溯一天数据，首次计算可能需要 30–60 秒…" },
    "3d":   { timeout: 420000, hint: "正在回溯三天数据，首次计算可能需要数分钟…" },
    "7d":   { timeout: 900000, hint: "正在回溯一周数据，首次计算可能需要 5–10 分钟…" }
};
var state = {
    window: localStorage.getItem("treehole-window") || "1d",
    limit: 50,
    visibleCount: 10,
    posts: [],
    controller: null
};

var statusEl = document.getElementById("status");
var statusText = document.getElementById("status-text");
var postList = document.getElementById("post-list");
var generatedAt = document.getElementById("generated-at");
var tabButtons = document.querySelectorAll(".window-tabs button");
var connection = document.getElementById("connection");
var connectionText = document.getElementById("connection-text");
var notice = document.getElementById("notice");
var refreshButton = document.getElementById("refresh");
var toast = document.getElementById("toast");
var loadMoreButton = document.getElementById("load-more");
var toastTimer = null;

function setStatus(type, text) {
    statusEl.className = "status " + type;
    statusText.textContent = text;
    statusEl.hidden = false;
}

function setConnection(type, text) {
    connection.className = "connection " + type;
    connectionText.textContent = text;
}

function timeAgo(ts) {
    var seconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(ts || 0));
    if (seconds < 60) return "刚刚";
    var mins = Math.floor(seconds / 60);
    if (mins < 60) return mins + " 分钟前";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + " 小时前";
    return Math.floor(hours / 24) + " 天前";
}

function showToast(pid) {
    toast.textContent = "已复制 #" + pid;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { toast.hidden = true; }, 1600);
}

function copyPid(pid) {
    var value = String(pid);
    var fallback = function() {
        var ta = document.createElement("textarea");
        ta.value = value;
        ta.style.cssText = "position:fixed;left:-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        showToast(value);
    };
    if (!navigator.clipboard) return fallback();
    navigator.clipboard.writeText(value).then(function() { showToast(value); }).catch(fallback);
}

function renderPosts(posts) {
    state.posts = posts;
    postList.replaceChildren();
    if (!posts.length) {
        loadMoreButton.hidden = true;
        setStatus("", "这个时间窗口暂时没有帖子");
        return;
    }
    statusEl.hidden = true;
    posts.slice(0, state.visibleCount).forEach(function(p) {
        var li = document.createElement("li");
        li.className = "post-item";
        li.dataset.rank = p.rank;

        var rank = document.createElement("span");
        rank.className = "post-rank";
        rank.textContent = p.rank;

        var main = document.createElement("div");
        main.className = "post-main";
        var text = document.createElement("p");
        text.className = "post-text";
        text.textContent = p.text || "（无正文）";
        var meta = document.createElement("div");
        meta.className = "post-meta";
        meta.innerHTML = "<span>⭐ " + Number(p.likenum || 0) + "</span>" +
            "<span>💬 " + Number(p.reply || 0) + "</span>" +
            "<span>👥 " + Number(p.unique_commenters || 0) + "</span>" +
            "<span>" + timeAgo(p.timestamp) + "</span>" +
            '<span class="pid">#' + Number(p.pid) + "</span>";
        var heat = document.createElement("div");
        heat.className = "heat";
        heat.textContent = "热度 " + Number(p.final_score || 0).toFixed(1);
        main.append(text, meta, heat);

        var copy = document.createElement("button");
        copy.className = "copy-button";
        copy.type = "button";
        copy.textContent = "复制洞号";
        copy.setAttribute("aria-label", "复制洞号 " + p.pid);
        copy.addEventListener("click", function() { copyPid(p.pid); });

        li.append(rank, main, copy);
        postList.appendChild(li);
    });

    var nextEnd = Math.min(state.visibleCount + 10, posts.length);
    loadMoreButton.hidden = state.visibleCount >= posts.length;
    if (!loadMoreButton.hidden) {
        loadMoreButton.textContent = "展开更多 · 第 " + (state.visibleCount + 1) + "–" + nextEnd + " 名";
    }
}

function showData(data) {
    renderPosts(data.posts || []);
    notice.hidden = !data.warning;
    notice.textContent = data.warning || "";
    if (data.generated_at) {
        generatedAt.textContent = (data.stale ? "上次成功更新 " : "更新于 ") +
            new Date(data.generated_at * 1000).toLocaleString("zh-CN", { hour12: false });
    }
    setConnection(data.stale ? "offline" : "online", data.stale ? "数据陈旧" : "服务正常");
}

function fetchTrending() {
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    var controller = state.controller;
    var requestedWindow = state.window;
    var profile = REQUEST_PROFILES[requestedWindow] || REQUEST_PROFILES["1d"];
    var timedOut = false;
    setStatus("loading", postList.children.length ? "正在后台更新，当前榜单仍可查看…" : profile.hint);
    refreshButton.disabled = true;
    notice.hidden = true;

    var timeout = setTimeout(function() { timedOut = true; controller.abort(); }, profile.timeout);
    var url = API_BASE + "/api/trending?window=" + encodeURIComponent(requestedWindow) + "&limit=" + state.limit;
    fetch(url, { signal: controller.signal })
        .then(function(resp) {
            if (!resp.ok) return resp.json().catch(function() { return {}; }).then(function(body) {
                var error = new Error(body.detail || "HTTP " + resp.status);
                error.httpStatus = resp.status;
                throw error;
            });
            return resp.json();
        })
        .then(showData)
        .catch(function(err) {
            if (err.name === "AbortError" && controller !== state.controller) return;
            if (timedOut) {
                setStatus("error", "本次计算时间过长，后端可能仍在处理；请稍后点击刷新");
            } else if (err.httpStatus) {
                setStatus("error", "树洞数据更新失败，请稍后重试");
                notice.hidden = false;
                notice.textContent = err.message;
            } else {
                setStatus("error", "无法连接本地服务，请确认后端已启动");
            }
            setConnection("offline", timedOut ? "计算中" : (err.httpStatus ? "更新失败" : "服务离线"));
        })
        .finally(function() {
            clearTimeout(timeout);
            if (controller === state.controller) refreshButton.disabled = false;
        });
}

tabButtons.forEach(function(btn) {
    if (btn.dataset.window === state.window) {
        tabButtons.forEach(function(b) { b.classList.remove("active"); });
        btn.classList.add("active");
    }
    btn.addEventListener("click", function() {
        tabButtons.forEach(function(b) { b.classList.remove("active"); });
        btn.classList.add("active");
        state.window = btn.dataset.window;
        state.visibleCount = 10;
        localStorage.setItem("treehole-window", state.window);
        fetchTrending();
    });
});

refreshButton.addEventListener("click", fetchTrending);
loadMoreButton.addEventListener("click", function() {
    state.visibleCount += 10;
    renderPosts(state.posts);
});
fetchTrending();
