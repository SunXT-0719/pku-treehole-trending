(function() {
    "use strict";

    var API_BASE = "http://localhost:8765";

    // === Toggle button (always visible) ===
    var toggleBtn = document.createElement("div");
    toggleBtn.id = "trending-toggle";
    toggleBtn.innerHTML = "&#x1f525;";
    toggleBtn.title = "树洞热帖";

    // === Sidebar panel ===
    var sidebar = document.createElement("div");
    sidebar.id = "trending-sidebar";
    sidebar.innerHTML =
        '<div class="trending-header">' +
        '<h3>&#x1f525; 热帖追踪</h3>' +
        '<div style="display:flex;gap:6px;align-items:center;">' +
        '<select class="trending-window">' +
        '<option value="1h">1小时</option>' +
        '<option value="0.5d">半天</option>' +
        '<option value="1d" selected>1天</option>' +
        '<option value="3d">3天</option>' +
        '<option value="7d">1周</option>' +
        '</select>' +
        '<button class="trending-refresh" title="刷新">&#x21bb;</button>' +
        '<button class="trending-close" title="收起">&times;</button>' +
        '</div>' +
        '</div>' +
        '<div class="trending-list"></div>' +
        '<div class="trending-updated"></div>' +
        '<div class="trending-toast" style="display:none;">已复制 #<span class="toast-pid"></span></div>';

    // === Styles ===
    var style = document.createElement("style");
    style.textContent =
        "#trending-toggle {" +
        "position:fixed;right:8px;top:50%;transform:translateY(-50%);" +
        "width:36px;height:36px;border-radius:50%;" +
        "background:#e65100;color:#fff;font-size:16px;" +
        "display:flex;align-items:center;justify-content:center;" +
        "cursor:pointer;z-index:99998;box-shadow:0 2px 8px rgba(0,0,0,0.2);" +
        "transition:opacity 0.2s;" +
        "}" +
        "#trending-toggle.hidden { opacity:0;pointer-events:none; }" +
        "#trending-sidebar {" +
        "position:fixed;right:-340px;top:0;width:320px;height:100vh;" +
        "background:#fff;box-shadow:-2px 0 12px rgba(0,0,0,0.1);" +
        "z-index:99999;overflow-y:auto;padding:16px;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;" +
        "transition:right 0.25s ease;" +
        "}" +
        "#trending-sidebar.open { right:0; }" +
        ".trending-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}" +
        ".trending-header h3{margin:0;color:#e65100;}" +
        ".trending-window{padding:4px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;}" +
        ".trending-refresh{background:none;border:1px solid #ddd;border-radius:6px;font-size:16px;color:#e65100;cursor:pointer;padding:2px 8px;line-height:1;}" +
        ".trending-refresh:hover{background:#fff3e0;}" +
        ".trending-close{background:none;border:none;font-size:20px;color:#999;cursor:pointer;padding:0 4px;line-height:1;}" +
        ".trending-close:hover{color:#333;}" +
        ".trending-item{padding:10px 0;border-bottom:1px solid #f0f0f0;cursor:pointer;transition:background 0.1s;}" +
        ".trending-item:hover{background:#fff8f0;}" +
        ".trending-item .rank{font-weight:700;color:#e65100;}" +
        ".trending-item .meta{font-size:11px;color:#888;margin:2px 0;}" +
        ".trending-item .text{font-size:13px;color:#444;margin-top:4px;line-height:1.4;}" +
        ".trending-item .pid-hint{font-size:10px;color:#ccc;margin-top:2px;}" +
        ".trending-loading{color:#888;text-align:center;padding:20px;}" +
        ".trending-updated{text-align:center;font-size:10px;color:#bbb;margin-top:12px;}" +
        ".trending-toast{" +
        "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);" +
        "background:#333;color:#fff;padding:8px 20px;border-radius:20px;" +
        "font-size:13px;z-index:100000;transition:opacity 0.3s;" +
        "}";

    document.head.appendChild(style);
    document.body.appendChild(toggleBtn);
    document.body.appendChild(sidebar);

    var list = sidebar.querySelector(".trending-list");
    var select = sidebar.querySelector(".trending-window");
    var refreshBtn = sidebar.querySelector(".trending-refresh");
    var closeBtn = sidebar.querySelector(".trending-close");
    var updatedEl = sidebar.querySelector(".trending-updated");
    var toast = sidebar.querySelector(".trending-toast");
    var toastPid = toast.querySelector(".toast-pid");

    var isOpen = false;

    function open() {
        sidebar.classList.add("open");
        toggleBtn.classList.add("hidden");
        isOpen = true;
    }

    function close() {
        sidebar.classList.remove("open");
        toggleBtn.classList.remove("hidden");
        isOpen = false;
    }

    toggleBtn.addEventListener("click", open);
    closeBtn.addEventListener("click", close);

    // Close sidebar when clicking outside of it
    document.addEventListener("click", function(e) {
        if (!isOpen) return;
        if (sidebar.contains(e.target) || toggleBtn.contains(e.target)) return;
        close();
    });

    function escapeHtml(s) {
        var div = document.createElement("div");
        div.textContent = s;
        return div.innerHTML;
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

    function showToast(pid) {
        toastPid.textContent = pid;
        toast.style.display = "";
        toast.style.opacity = "1";
        setTimeout(function() { toast.style.opacity = "0"; }, 1500);
        setTimeout(function() { toast.style.display = "none"; }, 1800);
    }

    function copyPid(pid) {
        navigator.clipboard.writeText(String(pid)).then(function() {
            showToast(pid);
        }).catch(function() {
            var ta = document.createElement("textarea");
            ta.value = String(pid);
            ta.style.position = "fixed;left:-9999px";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            showToast(pid);
        });
    }

    function load() {
        var window = select.value;
        list.innerHTML = '<div class="trending-loading">加载中...</div>';
        fetch(API_BASE + "/api/trending?window=" + window + "&limit=10")
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var now = Date.now();

                if (!data.posts || !data.posts.length) {
                    list.innerHTML = '<div class="trending-loading">暂无热帖</div>';
                    updatedEl.textContent = "";
                    return;
                }
                list.innerHTML = data.posts.map(function(p) {
                    return '<div class="trending-item" data-pid="' + p.pid + '">' +
                        '<span class="rank">#' + p.rank + '</span> ' +
                        '<span style="color:#e65100;font-weight:700">' + p.final_score + '分</span>' +
                        '<div class="meta">&#x2b50;' + p.likenum + ' &#x1f4ac;' + p.reply + ' &#x1f465;' + p.unique_commenters + '</div>' +
                        '<div class="text">' + escapeHtml(p.text || "").substring(0, 120) + '</div>' +
                        '<div class="pid-hint">' + timeAgo(p.timestamp) + ' · 点击复制 #' + p.pid + '</div>' +
                        '</div>';
                }).join("");

                updatedEl.textContent = "更新于 " + new Date(now).toLocaleTimeString("zh-CN", {hour:"2-digit",minute:"2-digit",second:"2-digit"});

                list.querySelectorAll(".trending-item").forEach(function(item) {
                    item.addEventListener("click", function() {
                        copyPid(this.dataset.pid);
                    });
                });
            })
            .catch(function() {
                list.innerHTML = '<div class="trending-loading" style="color:#d32f2f">连接后端失败</div>';
                updatedEl.textContent = "";
            });
    }

    // Only refresh button triggers load — window select only changes the value
    refreshBtn.addEventListener("click", load);
})();
