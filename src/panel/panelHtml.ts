// Single-file mobile control panel. Served by src/panel/panelServer.ts at `/`.
// No build step and no external assets: inline CSS + vanilla JS so the page
// works from any phone browser on the local network.
// All API calls send the session cookie set by POST /api/login; 401s bounce
// back to the login view.

export const PANEL_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#7c3aed" />
<title>Orbit Code — Painel</title>
<style>
:root {
  --bg: #0f0d1a; --card: #1b1630; --card2: #241d3d; --line: #332a55;
  --txt: #f1ecff; --muted: #b7abd9; --accent: #a855f7; --accent2: #7c3aed;
  --ok: #34d399; --warn: #fbbf24; --bad: #f87171;
  --radius: 14px;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--txt);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  padding-bottom: env(safe-area-inset-bottom);
}
header {
  position: sticky; top: 0; z-index: 5;
  background: linear-gradient(135deg, var(--accent2), #4c1d95);
  padding: calc(14px + env(safe-area-inset-top)) 16px 14px;
}
header h1 { margin: 0; font-size: 19px; }
header p { margin: 2px 0 0; font-size: 12px; opacity: .85; }
main { padding: 14px 14px 28px; max-width: 720px; margin: 0 auto; }
.card {
  background: var(--card); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 14px; margin-bottom: 12px;
}
.card h2 { margin: 0 0 10px; font-size: 15px; }
.row { display: flex; gap: 10px; align-items: center; }
.grow { flex: 1; min-width: 0; }
.muted { color: var(--muted); font-size: 13px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
input[type=text], input[type=password] {
  width: 100%; padding: 13px 12px; font-size: 16px; border-radius: 10px;
  border: 1px solid var(--line); background: var(--card2); color: var(--txt);
}
button {
  border: 0; border-radius: 10px; padding: 13px 16px; font-size: 15px; font-weight: 700;
  background: var(--accent); color: #fff; cursor: pointer; min-height: 48px;
}
button.secondary { background: var(--card2); border: 1px solid var(--line); color: var(--txt); }
button.danger { background: #7f1d1d; }
button:disabled { opacity: .5; }
button.small { padding: 8px 12px; font-size: 13px; min-height: 40px; }
.task { background: var(--card2); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
.task .top { display: flex; gap: 8px; align-items: baseline; }
.task .name { font-weight: 700; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
.b-green { background: rgba(52,211,153,.15); color: var(--ok); }
.b-yellow { background: rgba(251,191,36,.15); color: var(--warn); }
.b-red { background: rgba(248,113,113,.15); color: var(--bad); }
.b-gray { background: rgba(183,171,217,.15); color: var(--muted); }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
pre.logs {
  background: #0b0817; border: 1px solid var(--line); border-radius: 10px;
  padding: 10px; font-size: 11.5px; max-height: 320px; overflow: auto; white-space: pre-wrap;
}
.hidden { display: none !important; }
#error { background: #450a0a; border: 1px solid #7f1d1d; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; }
#ok-msg { background: #064e3b; border: 1px solid #065f46; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; }
.tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.tabs button { flex: 1; }
.tabs button.active { outline: 2px solid #fff; }
</style>
</head>
<body>
<header>
  <h1>⚡ Orbit Code</h1>
  <p id="server-line">Painel de controle</p>
</header>
<main>
  <div id="error" class="hidden"></div>
  <div id="ok-msg" class="hidden"></div>

  <section id="view-login" class="card">
    <h2>Entrar</h2>
    <p class="muted">Digite a senha do painel (criada no primeiro <span class="mono">oc serve</span>).</p>
    <form id="login-form">
      <input id="login-pass" type="password" placeholder="Senha" autocomplete="current-password" />
      <div style="height:10px"></div>
      <button type="submit" style="width:100%">Entrar</button>
    </form>
  </section>

  <section id="view-app" class="hidden">
    <div class="tabs">
      <button id="tab-tasks" class="secondary active">Tarefas</button>
      <button id="tab-new" class="secondary">Nova</button>
      <button id="tab-info" class="secondary">Servidor</button>
    </div>

    <div id="pane-tasks">
      <div class="card">
        <div class="row">
          <h2 class="grow">Tarefas em segundo plano</h2>
          <button id="btn-refresh" class="secondary small">Atualizar</button>
        </div>
        <div id="task-list"><p class="muted">Carregando…</p></div>
      </div>
      <div id="task-detail" class="card hidden">
        <h2 id="detail-title">Tarefa</h2>
        <p class="muted mono" id="detail-meta"></p>
        <div class="row" style="margin-bottom:10px">
          <button id="btn-logs-out" class="secondary small">stdout</button>
          <button id="btn-logs-err" class="secondary small">stderr</button>
        </div>
        <pre class="logs" id="detail-logs">Selecione stdout ou stderr.</pre>
        <div class="actions">
          <button id="btn-kill" class="danger">Encerrar</button>
          <button id="btn-logout" class="secondary">Sair</button>
        </div>
      </div>
    </div>

    <div id="pane-new" class="hidden">
      <div class="card">
        <h2>Nova tarefa</h2>
        <p class="muted">Roda <span class="mono">openclaude --print</span> em segundo plano no projeto atual.</p>
        <input id="new-name" type="text" placeholder="Nome (opcional)" />
        <div style="height:10px"></div>
        <input id="new-prompt" type="text" placeholder="Prompt: ex. rode os testes e resuma" />
        <div style="height:10px"></div>
        <button id="btn-start" style="width:100%">Iniciar</button>
      </div>
    </div>

    <div id="pane-info" class="hidden">
      <div class="card">
        <h2>Servidor</h2>
        <p class="muted mono" id="info-lines">…</p>
      </div>
    </div>
  </section>
</main>
<script>
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var state = { detailId: null, logStream: "stdout", info: null };

  function showError(msg) {
    var el = $("error"); el.textContent = msg; el.classList.remove("hidden");
    setTimeout(function () { el.classList.add("hidden"); }, 6000);
  }
  function showOk(msg) {
    var el = $("ok-msg"); el.textContent = msg; el.classList.remove("hidden");
    setTimeout(function () { el.classList.add("hidden"); }, 4000);
  }
  async function api(path, opts) {
    var res = await fetch(path, opts);
    if (res.status === 401) { showApp(false); throw new Error("Sessão expirada — entre de novo."); }
    var data = null;
    try { data = await res.json(); } catch (e) { /* corpo vazio */ }
    if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    return data;
  }
  function showApp(logged) {
    $("view-login").classList.toggle("hidden", logged);
    $("view-app").classList.toggle("hidden", !logged);
    if (logged) { loadTasks(); loadInfo(); }
  }
  function badge(status) {
    var cls = "b-gray";
    if (status === "running") cls = "b-green";
    else if (status === "unknown" || status === "stale") cls = "b-yellow";
    else cls = "b-red";
    return '<span class="badge ' + cls + '">' + status + "</span>";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  async function loadTasks() {
    try {
      var data = await api("/api/tasks");
      var list = $("task-list");
      if (!data.tasks || data.tasks.length === 0) {
        list.innerHTML = '<p class="muted">Nenhuma tarefa. Crie uma na aba Nova.</p>';
        return;
      }
      list.innerHTML = data.tasks.map(function (t) {
        var label = esc(t.name || t.id);
        return '<div class="task" data-id="' + esc(t.id) + '">' +
          '<div class="top"><span class="name grow">' + label + "</span>" + badge(t.status) + "</div>" +
          '<div class="muted mono">pid ' + t.pid + " · " + esc(t.updatedAt || "") + "</div></div>";
      }).join("");
      var nodes = list.querySelectorAll(".task");
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].addEventListener("click", function () {
          openDetail(this.getAttribute("data-id"));
        });
      }
    } catch (e) { showError(e.message); }
  }
  async function openDetail(id) {
    state.detailId = id;
    $("task-detail").classList.remove("hidden");
    try {
      var data = await api("/api/tasks");
      var t = null;
      for (var i = 0; i < data.tasks.length; i++) {
        if (data.tasks[i].id === id) t = data.tasks[i];
      }
      if (!t) { showError("Tarefa não encontrada."); return; }
      $("detail-title").textContent = t.name || t.id;
      $("detail-meta").textContent = "id " + t.id + " · pid " + t.pid + " · " + t.status + "\\n" + (t.cwd || "");
      await loadLogs();
      $("task-detail").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { showError(e.message); }
  }
  async function loadLogs() {
    if (!state.detailId) return;
    try {
      var data = await api("/api/tasks/" + encodeURIComponent(state.detailId) +
        "/logs?stream=" + state.logStream + "&tail=120");
      $("detail-logs").textContent = data.logs || "(log vazio)";
    } catch (e) { showError(e.message); }
  }
  async function loadInfo() {
    try {
      var data = await api("/api/info");
      state.info = data;
      $("server-line").textContent = "v" + data.version + " · " + (data.lanUrls[0] || "rede local");
      $("info-lines").textContent =
        "versão: " + data.version + "\\n" +
        "projeto: " + data.cwd + "\\n" +
        "local: " + data.localUrl + "\\n" +
        "rede: " + (data.lanUrls.join("\\n") || "(nenhum IPv4)");
    } catch (e) { /* painel segue utilizável sem o bloco info */ }
  }
  function switchTab(which) {
    var tabs = ["tasks", "new", "info"];
    for (var i = 0; i < tabs.length; i++) {
      $("pane-" + tabs[i]).classList.toggle("hidden", tabs[i] !== which);
      $("tab-" + tabs[i]).classList.toggle("active", tabs[i] === which);
    }
  }

  $("login-form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var pass = $("login-pass").value;
    $("login-pass").value = "";
    try {
      await api("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pass })
      });
      showOk("Bem-vindo!");
      showApp(true);
    } catch (e) { showError(e.message); }
  });
  $("btn-refresh").addEventListener("click", loadTasks);
  $("tab-tasks").addEventListener("click", function () { switchTab("tasks"); });
  $("tab-new").addEventListener("click", function () { switchTab("new"); });
  $("tab-info").addEventListener("click", function () { switchTab("info"); loadInfo(); });
  $("btn-logs-out").addEventListener("click", function () { state.logStream = "stdout"; loadLogs(); });
  $("btn-logs-err").addEventListener("click", function () { state.logStream = "stderr"; loadLogs(); });
  $("btn-kill").addEventListener("click", async function () {
    if (!state.detailId) return;
    if (!window.confirm("Encerrar esta tarefa?")) return;
    try {
      await api("/api/tasks/" + encodeURIComponent(state.detailId) + "/kill", { method: "POST" });
      showOk("Tarefa encerrada.");
      $("task-detail").classList.add("hidden");
      state.detailId = null;
      loadTasks();
    } catch (e) { showError(e.message); }
  });
  $("btn-start").addEventListener("click", async function () {
    var btn = $("btn-start"); btn.disabled = true;
    try {
      var data = await api("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: $("new-name").value, prompt: $("new-prompt").value })
      });
      $("new-name").value = ""; $("new-prompt").value = "";
      showOk("Tarefa criada: " + (data.task.name || data.task.id));
      switchTab("tasks");
      loadTasks();
    } catch (e) { showError(e.message); }
    btn.disabled = false;
  });
  $("btn-logout").addEventListener("click", async function () {
    try { await api("/api/logout", { method: "POST" }); } catch (e) { /* segue para o login */ }
    showApp(false);
  });

  // Se já há sessão válida, pula o login.
  api("/api/tasks").then(function () { showApp(true); }).catch(function () { showApp(false); });
})();
</script>
</body>
</html>`
