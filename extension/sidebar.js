(function() {
    "use strict";

    if (document.getElementById("treehole-trending-root")) return;

    var API_BASE = "http://localhost:8765";
    var REQUEST_PROFILES = {
        "1h":{timeout:60000,hint:"正在获取热帖…"},
        "0.5d":{timeout:120000,hint:"首次计算半天榜单可能需要约 30 秒…"},
        "1d":{timeout:180000,hint:"首次计算一天榜单可能需要 30–60 秒…"},
        "3d":{timeout:420000,hint:"首次计算三天榜单可能需要数分钟…"},
        "7d":{timeout:900000,hint:"首次计算一周榜单可能需要 5–10 分钟…"}
    };
    var host = document.createElement("div");
    host.id = "treehole-trending-root";
    var shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML = `
        <style>
            :host { all: initial; --accent:#d8582b; --accent-dark:#b84320; --accent-soft:#fff0e9; --ink:#292421; --muted:#746b66; --line:#eee6e1; font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif; }
            * { box-sizing:border-box; }
            button,select { font:inherit; }
            .toggle { position:fixed; right:14px; top:50%; z-index:2147483646; display:grid; width:44px; height:44px; padding:0; place-items:center; transform:translateY(-50%); border:1px solid rgba(255,255,255,.75); border-radius:15px; background:linear-gradient(145deg,#ff8c56,var(--accent)); color:#fff; box-shadow:0 10px 28px rgba(96,49,27,.28); cursor:pointer; font-size:20px; transition:160ms ease; }
            .toggle:hover { transform:translateY(-50%) scale(1.04); }
            .toggle.hidden { opacity:0; pointer-events:none; transform:translate(10px,-50%); }
            .panel { position:fixed; top:0; right:0; z-index:2147483647; display:flex; width:min(380px,calc(100vw - 20px)); height:100dvh; flex-direction:column; overflow:hidden; transform:translateX(calc(100% + 24px)); border-left:1px solid rgba(255,255,255,.8); background:rgba(255,255,255,.96); color:var(--ink); box-shadow:-18px 0 55px rgba(64,39,25,.18); backdrop-filter:blur(20px); transition:transform 220ms cubic-bezier(.2,.75,.2,1); }
            .panel.open { transform:translateX(0); }
            header { display:flex; align-items:center; gap:11px; padding:18px 17px 13px; }
            .brand { display:grid; width:40px; height:40px; flex:none; place-items:center; border-radius:13px; background:linear-gradient(145deg,#ff8c56,var(--accent)); box-shadow:0 7px 16px rgba(216,88,43,.22); font-size:19px; }
            .eyebrow { color:var(--accent); font-size:9px; font-weight:800; letter-spacing:.13em; }
            h2 { margin:2px 0 0; font-size:19px; line-height:1.1; letter-spacing:-.03em; }
            .header-actions { display:flex; gap:6px; margin-left:auto; }
            .icon { display:grid; width:33px; height:33px; padding:0; place-items:center; border:1px solid var(--line); border-radius:10px; background:#fff; color:var(--muted); cursor:pointer; font-size:17px; }
            .icon:hover { background:var(--accent-soft); color:var(--accent-dark); }
            .refresh.busy .refresh-glyph { display:inline-block; animation:spin .75s linear infinite; }
            @keyframes spin { to { transform:rotate(360deg); } }
            .toolbar { display:grid; grid-template-columns:1fr auto; gap:8px; padding:0 17px 13px; }
            select { min-height:37px; padding:0 11px; border:1px solid var(--line); border-radius:11px; outline:none; background:#f8f4f1; color:var(--ink); font-size:12px; font-weight:650; }
            .connection { display:flex; align-items:center; gap:6px; padding:0 10px; border:1px solid var(--line); border-radius:11px; color:var(--muted); font-size:10px; }
            .dot { width:7px; height:7px; border-radius:50%; background:#d2a03c; }
            .dot.online { background:#47a16c; }
            .dot.offline { background:#c94d4d; }
            .dot.loading { width:11px; height:11px; border:2px solid #ebdfd8; border-top-color:var(--accent); background:transparent; animation:spin .7s linear infinite; }
            .notice { margin:0 17px 10px; padding:9px 10px; border:1px solid #f0d49c; border-radius:10px; background:#fff8e8; color:#826022; font-size:11px; line-height:1.4; }
            .notice[hidden] { display:none; }
            .list { display:grid; flex:1; align-content:start; gap:8px; margin:0; padding:3px 12px 16px; overflow-y:auto; overscroll-behavior:contain; }
            .state { display:grid; min-height:190px; place-items:center; padding:24px; color:var(--muted); text-align:center; font-size:12px; line-height:1.6; }
            .state button { margin-top:9px; padding:7px 11px; border:0; border-radius:9px; background:var(--accent-soft); color:var(--accent-dark); cursor:pointer; font-weight:700; }
            .item { display:grid; grid-template-columns:32px minmax(0,1fr) 30px; gap:9px; padding:12px; border:1px solid var(--line); border-radius:13px; background:#fff; transition:140ms ease; }
            .item:hover { transform:translateY(-1px); border-color:#e3c3b4; box-shadow:0 7px 18px rgba(75,47,31,.07); }
            .rank { display:grid; width:31px; height:31px; place-items:center; border-radius:9px; background:#f3eeea; color:var(--muted); font-size:11px; font-weight:850; }
            .item[data-rank="1"] .rank { background:linear-gradient(145deg,#ff8c56,var(--accent)); color:#fff; box-shadow:0 5px 12px rgba(216,88,43,.2); }
            .item[data-rank="2"] .rank { background:#f3ddd2; color:#a34829; }
            .item[data-rank="3"] .rank { background:#f5e8cd; color:#87631f; }
            .content { min-width:0; }
            .text { margin:0; overflow:hidden; color:#3d3835; font-size:12px; font-weight:560; line-height:1.5; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; }
            .meta { display:flex; flex-wrap:wrap; gap:7px; margin-top:7px; color:var(--muted); font-size:10px; }
            .heat { color:var(--accent-dark); font-weight:750; }
            .copy { align-self:center; width:30px; height:30px; padding:0; border:1px solid var(--line); border-radius:8px; background:#fff; color:#9a8f88; cursor:pointer; }
            .copy:hover { background:var(--accent-soft); color:var(--accent); }
            .load-more { margin:0 12px 9px; padding:9px 10px; border:1px dashed #dfc7ba; border-radius:10px; background:#fffaf7; color:var(--accent-dark); cursor:pointer; font-size:11px; font-weight:750; }
            .load-more:hover { border-style:solid; background:var(--accent-soft); }
            .load-more[hidden] { display:none; }
            footer { display:flex; justify-content:space-between; gap:10px; padding:10px 17px calc(11px + env(safe-area-inset-bottom)); border-top:1px solid var(--line); color:#9c918b; font-size:9px; }
            .toast { position:fixed; right:18px; bottom:48px; z-index:2; padding:8px 12px; border-radius:999px; background:#2e2927; color:#fff; box-shadow:0 8px 22px rgba(0,0,0,.2); font-size:11px; }
            .toast[hidden] { display:none; }
            button:focus-visible,select:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
            @media (prefers-color-scheme:dark) {
                :host { --ink:#f4ece7; --muted:#b6aaa3; --line:#463b35; --accent-soft:#4a2b22; }
                .panel { border-color:#493b34; background:rgba(40,34,31,.97); }
                .icon,.item,.copy,.load-more { background:#302925; }
                select { background:#352d29; color:var(--ink); }
                .text { color:#eee4dd; }
                .notice { background:#3d3320; border-color:#65532b; color:#e3c67f; }
                .rank { background:#3a312d; }
            }
            @media (prefers-reduced-motion:reduce) { * { animation-duration:.01ms!important; transition-duration:.01ms!important; } }
        </style>
        <button class="toggle" type="button" title="打开此刻热帖" aria-label="打开此刻热帖">🔥</button>
        <aside class="panel" aria-label="此刻热帖" aria-hidden="true">
            <header>
                <div class="brand">🔥</div>
                <div><div class="eyebrow">PKU TREEHOLE</div><h2>此刻热帖</h2></div>
                <div class="header-actions">
                    <button class="icon refresh" type="button" title="刷新" aria-label="刷新"><span class="refresh-glyph" aria-hidden="true">↻</span></button>
                    <button class="icon close" type="button" title="收起" aria-label="收起">×</button>
                </div>
            </header>
            <div class="toolbar">
                <select class="window" aria-label="时间窗口">
                    <option value="1h">最近 1 小时</option><option value="0.5d">最近半天</option><option value="1d">最近 1 天</option><option value="3d">最近 3 天</option><option value="7d">最近 1 周</option>
                </select>
                <div class="connection"><span class="dot"></span><span class="connection-text">连接中</span></div>
            </div>
            <div class="notice" hidden></div>
            <div class="list"><div class="state">打开后自动获取热帖</div></div>
            <button class="load-more" type="button" hidden></button>
            <footer><span class="updated">等待首次更新</span><span>点击右侧按钮复制洞号</span></footer>
            <div class="toast" hidden>已复制</div>
        </aside>`;

    (document.body || document.documentElement).appendChild(host);

    var toggle = shadow.querySelector(".toggle");
    var panel = shadow.querySelector(".panel");
    var closeButton = shadow.querySelector(".close");
    var refreshButton = shadow.querySelector(".refresh");
    var select = shadow.querySelector(".window");
    var list = shadow.querySelector(".list");
    var notice = shadow.querySelector(".notice");
    var updated = shadow.querySelector(".updated");
    var dot = shadow.querySelector(".dot");
    var connectionText = shadow.querySelector(".connection-text");
    var toast = shadow.querySelector(".toast");
    var loadMoreButton = shadow.querySelector(".load-more");
    var state = { open:false, loaded:false, controller:null, window:"1d", visibleCount:10, posts:[], data:null, fromStorage:false };

    function createSafeStorage() {
        var nativeStorage=null;
        try { nativeStorage=window.chrome&&window.chrome.storage&&window.chrome.storage.local; } catch(error) { nativeStorage=null; }

        function localGet(keys,callback) {
            var result={};
            keys.forEach(function(key){
                try { var value=localStorage.getItem(key); if(value!==null)result[key]=JSON.parse(value); } catch(error) {}
            });
            callback(result);
        }

        return {
            get:function(keys,callback) {
                if(!nativeStorage)return localGet(keys,callback);
                try {
                    nativeStorage.get(keys,function(result){
                        try { if(window.chrome.runtime.lastError)return callback({}); } catch(error) { return callback({}); }
                        callback(result||{});
                    });
                } catch(error) {
                    // An extension reload invalidates old content-script contexts.
                    callback({});
                }
            },
            set:function(values) {
                if(!nativeStorage) {
                    Object.keys(values).forEach(function(key){try{localStorage.setItem(key,JSON.stringify(values[key]));}catch(error){}});
                    return;
                }
                try {
                    nativeStorage.set(values,function(){try{void window.chrome.runtime.lastError;}catch(error){}});
                } catch(error) {
                    // Cache persistence is best-effort and must never block render.
                }
            }
        };
    }

    var storage=createSafeStorage();

    function cacheKey(windowName) { return "trending-cache-" + windowName; }
    function timeAgo(ts) {
        var sec = Math.max(0, Math.floor(Date.now()/1000) - Number(ts || 0));
        if (sec < 60) return "刚刚";
        if (sec < 3600) return Math.floor(sec/60) + " 分钟前";
        if (sec < 86400) return Math.floor(sec/3600) + " 小时前";
        return Math.floor(sec/86400) + " 天前";
    }
    function setConnection(kind, text) { dot.className = "dot " + kind; connectionText.textContent = text; }
    function setNotice(text) { notice.textContent = text || ""; notice.hidden = !text; }
    function showToast(pid) { toast.textContent = "已复制 #" + pid; toast.hidden = false; setTimeout(function(){ toast.hidden = true; }, 1500); }
    function copyPid(pid) {
        var fallback = function(){ var input=document.createElement("textarea"); input.value=String(pid); document.body.appendChild(input); input.select(); document.execCommand("copy"); input.remove(); showToast(pid); };
        if (!navigator.clipboard) return fallback();
        navigator.clipboard.writeText(String(pid)).then(function(){ showToast(pid); }).catch(fallback);
    }
    function showState(message, retry) {
        list.replaceChildren();
        loadMoreButton.hidden=true;
        var el = document.createElement("div"); el.className = "state"; el.textContent = message;
        if (retry) { var button=document.createElement("button"); button.type="button"; button.textContent="重新尝试"; button.addEventListener("click",load); el.appendChild(document.createElement("br")); el.appendChild(button); }
        list.appendChild(el);
    }
    function render(data, fromStorage) {
        var posts = data.posts || [];
        state.posts=posts; state.data=data; state.fromStorage=fromStorage;
        list.replaceChildren();
        var stale=Boolean(data.stale||fromStorage);
        setNotice(data.warning||(fromStorage?"正在展示上次结果，并在后台更新":""));
        updated.textContent=data.generated_at?(stale?"缓存更新于 ":"更新于 ")+new Date(data.generated_at*1000).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}):"";
        setConnection(stale?"offline":"online",stale?"缓存":"在线");
        if (!posts.length) { showState("这个窗口暂时没有热帖",false); return; }
        posts.slice(0,state.visibleCount).forEach(function(p) {
            var item=document.createElement("article"); item.className="item"; item.dataset.rank=p.rank;
            var rank=document.createElement("span"); rank.className="rank"; rank.textContent=p.rank;
            var content=document.createElement("div"); content.className="content";
            var text=document.createElement("p"); text.className="text"; text.textContent=p.text||"（无正文）";
            var meta=document.createElement("div"); meta.className="meta";
            meta.innerHTML="<span>⭐"+Number(p.likenum||0)+"</span><span>💬"+Number(p.reply||0)+"</span><span>👥"+Number(p.unique_commenters||0)+"</span><span>"+timeAgo(p.timestamp)+'</span><span class="heat">热度 '+Number(p.final_score||0).toFixed(1)+"</span>";
            content.append(text,meta);
            var copy=document.createElement("button"); copy.className="copy"; copy.type="button"; copy.title="复制 #"+p.pid; copy.setAttribute("aria-label","复制洞号 "+p.pid); copy.textContent="⧉"; copy.addEventListener("click",function(){copyPid(p.pid);});
            item.append(rank,content,copy); list.appendChild(item);
        });
        var nextEnd=Math.min(state.visibleCount+10,posts.length);
        loadMoreButton.hidden=state.visibleCount>=posts.length;
        if(!loadMoreButton.hidden)loadMoreButton.textContent="展开第 "+(state.visibleCount+1)+"–"+nextEnd+" 名";
    }
    function readCache(windowName) { return new Promise(function(resolve){ storage.get([cacheKey(windowName)],function(result){resolve(result[cacheKey(windowName)]||null);}); }); }
    function writeCache(windowName,data) { var value={}; value[cacheKey(windowName)]=data; storage.set(value); }
    function load() {
        if (state.controller) state.controller.abort();
        var controller=new AbortController(); state.controller=controller; refreshButton.classList.add("busy");
        var requestedWindow=state.window;
        var profile=REQUEST_PROFILES[requestedWindow]||REQUEST_PROFILES["1d"];
        var timedOut=false;
        var freshReceived=false;
        setConnection("loading","更新中");
        readCache(requestedWindow).then(function(cached){
            if(controller!==state.controller||freshReceived)return;
            if(cached){render(cached,true);setConnection("loading","更新中");}
            else showState(profile.hint,false);
        });
        var timer=setTimeout(function(){timedOut=true;controller.abort();},profile.timeout);
        fetch(API_BASE+"/api/trending?window="+encodeURIComponent(requestedWindow)+"&limit=50",{signal:controller.signal})
            .then(function(response){ if(!response.ok)return response.json().catch(function(){return {};}).then(function(body){var error=new Error(body.detail||"HTTP "+response.status);error.httpStatus=response.status;throw error;}); return response.json(); })
            .then(function(data){ freshReceived=true; state.loaded=true; render(data,false); writeCache(requestedWindow,data); })
            .catch(function(error){
                if(error.name==="AbortError"&&controller!==state.controller)return;
                var hasPosts=Boolean(list.querySelector(".item"));
                var message=timedOut?"计算仍在后台进行，请稍后重试":(error.httpStatus?"树洞数据更新失败":"本地服务未连接");
                if(!hasPosts)showState(message,true);
                setNotice(hasPosts?"更新未完成，已保留上次结果":(error.httpStatus?error.message:message));
                setConnection("offline",timedOut?"计算中":"离线");
            })
            .finally(function(){clearTimeout(timer);if(controller===state.controller)refreshButton.classList.remove("busy");});
    }
    function open() { panel.classList.add("open"); panel.setAttribute("aria-hidden","false"); toggle.classList.add("hidden"); state.open=true; if(!state.loaded)load(); }
    function close() { panel.classList.remove("open"); panel.setAttribute("aria-hidden","true"); toggle.classList.remove("hidden"); state.open=false; }

    toggle.addEventListener("click",open);
    closeButton.addEventListener("click",close);
    refreshButton.addEventListener("click",load);
    select.addEventListener("change",function(){ state.window=select.value; state.loaded=false; state.visibleCount=10; storage.set({"trending-window":state.window}); load(); });
    loadMoreButton.addEventListener("click",function(){state.visibleCount+=10;render(state.data,state.fromStorage);});
    document.addEventListener("keydown",function(event){if(event.key==="Escape"&&state.open)close();});
    storage.get(["trending-window"],function(result){ state.window=result["trending-window"]||"1d"; select.value=state.window; });
})();
