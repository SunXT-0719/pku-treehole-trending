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
