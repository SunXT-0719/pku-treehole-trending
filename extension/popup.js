"use strict";

var API_BASE = "http://localhost:8765";
var REQUEST_PROFILES = {
    "1h":   {timeout:60000, hint:"正在获取热帖…"},
    "0.5d": {timeout:120000, hint:"首次计算半天榜单可能需要约 30 秒…"},
    "1d":   {timeout:180000, hint:"首次计算一天榜单可能需要 30–60 秒…"},
    "3d":   {timeout:420000, hint:"首次计算三天榜单可能需要数分钟…"},
    "7d":   {timeout:900000, hint:"首次计算一周榜单可能需要 5–10 分钟…"}
};
var state = { window: "1d", visibleCount: 10, posts: [], data: null, fromStorage: false, controller: null };
var list = document.getElementById("post-list");
var statusEl = document.getElementById("status");
var statusText = document.getElementById("status-text");
var generatedAt = document.getElementById("generated-at");
var refresh = document.getElementById("refresh");
var notice = document.getElementById("notice");
var dot = document.getElementById("connection-dot");
var connectionText = document.getElementById("connection-text");
var toast = document.getElementById("toast");
var tabs = document.querySelectorAll(".window-tabs button");
var loadMore = document.getElementById("load-more");
var storage = (window.chrome && chrome.storage && chrome.storage.local) ? chrome.storage.local : {
    get: function(keys, callback) {
        var result = {};
        keys.forEach(function(key) {
            var value = localStorage.getItem(key);
            if (value !== null) result[key] = JSON.parse(value);
        });
        callback(result);
    },
    set: function(values) {
        Object.keys(values).forEach(function(key) {
            localStorage.setItem(key, JSON.stringify(values[key]));
        });
    }
};

function cacheKey(windowName) { return "trending-cache-" + windowName; }
function setStatus(kind, text) { statusEl.className = "status " + kind; statusText.textContent = text; statusEl.hidden = false; }
function setConnection(kind, text) { dot.className = "dot " + kind; connectionText.textContent = text; }
function timeAgo(ts) {
    var sec = Math.max(0, Math.floor(Date.now()/1000) - Number(ts || 0));
    if (sec < 60) return "刚刚";
    if (sec < 3600) return Math.floor(sec/60) + "分钟前";
    if (sec < 86400) return Math.floor(sec/3600) + "小时前";
    return Math.floor(sec/86400) + "天前";
}
function showToast(pid) {
    toast.textContent = "已复制 #" + pid;
    toast.hidden = false;
    setTimeout(function(){ toast.hidden = true; }, 1400);
}
function copyPid(pid) {
    navigator.clipboard.writeText(String(pid)).then(function(){ showToast(pid); }).catch(function(){
        var input = document.createElement("textarea");
        input.value = String(pid); document.body.appendChild(input); input.select(); document.execCommand("copy"); input.remove(); showToast(pid);
    });
}
function render(data, fromStorage) {
    var posts = data.posts || [];
    state.posts = posts;
    state.data = data;
    state.fromStorage = fromStorage;
    list.replaceChildren();
    if (!posts.length) { loadMore.hidden = true; setStatus("", "这个窗口暂时没有热帖"); return; }
    statusEl.hidden = true;
    posts.slice(0, state.visibleCount).forEach(function(p) {
        var item = document.createElement("li"); item.className = "post-item"; item.dataset.rank = p.rank;
        var rank = document.createElement("span"); rank.className = "rank"; rank.textContent = p.rank;
        var content = document.createElement("div"); content.className = "content";
        var text = document.createElement("p"); text.className = "text"; text.textContent = p.text || "（无正文）";
        var meta = document.createElement("div"); meta.className = "meta";
        meta.innerHTML = "<span>⭐" + Number(p.likenum || 0) + "</span><span>💬" + Number(p.reply || 0) + "</span><span>👥" + Number(p.unique_commenters || 0) + "</span><span>" + timeAgo(p.timestamp) + '</span><span class="heat">热度 ' + Number(p.final_score || 0).toFixed(1) + "</span>";
        content.append(text, meta);
        var copy = document.createElement("button"); copy.className = "copy"; copy.type = "button"; copy.title = "复制 #" + p.pid; copy.textContent = "⧉";
        copy.setAttribute("aria-label", "复制洞号 " + p.pid);
        copy.addEventListener("click", function(){ copyPid(p.pid); });
        item.append(rank, content, copy); list.appendChild(item);
    });
    var nextEnd = Math.min(state.visibleCount + 10, posts.length);
    loadMore.hidden = state.visibleCount >= posts.length;
    if (!loadMore.hidden) loadMore.textContent = "展开第 " + (state.visibleCount + 1) + "–" + nextEnd + " 名";
    var stale = Boolean(data.stale || fromStorage);
    notice.hidden = !(data.warning || fromStorage);
    notice.textContent = data.warning || (fromStorage ? "正在展示上次结果，并在后台更新" : "");
    generatedAt.textContent = data.generated_at ? timeAgo(data.generated_at) + "更新" : "";
    setConnection(stale ? "offline" : "online", stale ? "缓存" : "在线");
}
function readCache(windowName) {
    return new Promise(function(resolve) {
        storage.get([cacheKey(windowName)], function(result) { resolve(result[cacheKey(windowName)] || null); });
    });
}
function writeCache(windowName, data) {
    var value = {}; value[cacheKey(windowName)] = data; storage.set(value);
}
function load() {
    if (state.controller) state.controller.abort();
    var controller = new AbortController(); state.controller = controller;
    var requestedWindow = state.window;
    var profile = REQUEST_PROFILES[requestedWindow] || REQUEST_PROFILES["1d"];
    var timedOut = false;
    refresh.disabled = true;
    var freshReceived = false;
    readCache(requestedWindow).then(function(cached) {
        if (controller !== state.controller) return;
        if (freshReceived) return;
        if (cached) render(cached, true); else setStatus("loading", profile.hint);
    });
    var timer = setTimeout(function(){ timedOut = true; controller.abort(); }, profile.timeout);
    fetch(API_BASE + "/api/trending?window=" + encodeURIComponent(requestedWindow) + "&limit=50", {signal:controller.signal})
        .then(function(response) {
            if (!response.ok) return response.json().catch(function(){return {};}).then(function(body){
                var error = new Error(body.detail || "HTTP " + response.status);
                error.httpStatus = response.status;
                throw error;
            });
            return response.json();
        })
        .then(function(data){ freshReceived = true; writeCache(requestedWindow, data); render(data, false); })
        .catch(function(error){
            if (error.name === "AbortError" && controller !== state.controller) return;
            var hasPosts = Boolean(list.querySelector(".post-item"));
            var message = timedOut ? "计算仍在后台进行，请稍后重试" : (error.httpStatus ? "树洞数据更新失败" : "本地服务未连接");
            if (!hasPosts) setStatus("error", message);
            notice.hidden = false;
            notice.textContent = hasPosts ? "更新未完成，已保留上次结果" : (error.httpStatus ? error.message : message);
            setConnection("offline", timedOut ? "计算中" : "离线");
        })
        .finally(function(){ clearTimeout(timer); if (controller === state.controller) refresh.disabled = false; });
}

storage.get(["trending-window"], function(result) {
    state.window = result["trending-window"] || "1d";
    tabs.forEach(function(tab) {
        tab.classList.toggle("active", tab.dataset.window === state.window);
        tab.addEventListener("click", function(){
            tabs.forEach(function(t){ t.classList.remove("active"); }); tab.classList.add("active");
            state.window = tab.dataset.window; state.visibleCount = 10; storage.set({"trending-window":state.window}); load();
        });
    });
    load();
});
refresh.addEventListener("click", load);
loadMore.addEventListener("click", function() {
    state.visibleCount += 10;
    render(state.data, state.fromStorage);
});
