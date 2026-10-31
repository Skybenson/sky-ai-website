
(() => {
  const $ = id => document.getElementById(id);
  let client = null;

  const panels = ["loadingPanel", "loginPanel", "deniedPanel", "dashboardPanel"];

  function show(panel) {
    panels.forEach(id => $(id).classList.toggle("hidden", id !== panel));
  }

  function number(value) {
    return new Intl.NumberFormat("en-NG").format(Number(value || 0));
  }

  function date(value) {
    if (!value) return "Never";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "—";
    return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(parsed);
  }

  function setMessage(id, text, isError = false) {
    const el = $(id);
    el.textContent = text || "";
    el.classList.toggle("error-text", Boolean(isError));
  }

  async function setup() {
    try {
      const configResponse = await fetch("/api/config");
      const config = await configResponse.json();

      if (!configResponse.ok || !config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
        throw new Error("Sky's sign-in service could not be loaded.");
      }

      client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      const { data, error } = await client.auth.getSession();

      if (error) throw error;

      if (data.session) await loadDashboard();
      else show("loginPanel");

    } catch (error) {
      show("loginPanel");
      setMessage("loginMessage", error.message || "Unable to start the dashboard.", true);
    }
  }

  async function loadDashboard() {
    show("loadingPanel");
    setMessage("loginMessage", "");

    const { data: sessionData } = await client.auth.getSession();

    if (!sessionData.session) {
      show("loginPanel");
      return;
    }

    const { data, error } = await client.rpc("sky_admin_dashboard");

    if (error) {
      const message = error.message || "Access denied.";

      if (/not authorized|permission denied|42501/i.test(message)) {
        show("deniedPanel");
      } else {
        show("loginPanel");
        setMessage("loginMessage", `Dashboard setup is incomplete: ${message}`, true);
      }

      return;
    }

    if (!data || !data.totals) {
      show("loginPanel");
      setMessage("loginMessage", "The dashboard returned an unexpected response.", true);
      return;
    }

    render(data);
    show("dashboardPanel");
  }

  function renderChart(targetId, rows, colorClass) {
    const el = $(targetId);
    el.replaceChildren();

    const max = Math.max(1, ...rows.map(row => Number(row.count || 0)));

    rows.forEach(row => {
      const item = document.createElement("div");
      item.className = "bar-item";

      const value = document.createElement("span");
      value.className = "bar-value";
      value.textContent = number(row.count);

      const track = document.createElement("div");
      track.className = "bar-track";

      const bar = document.createElement("div");
      bar.className = `bar-fill ${colorClass}`;
      bar.style.height = `${Math.max(3, (Number(row.count || 0) / max) * 100)}%`;
      bar.title = `${row.date}: ${number(row.count)}`;

      track.appendChild(bar);

      const label = document.createElement("span");
      label.className = "bar-label";

      const d = new Date(`${row.date}T00:00:00`);

      label.textContent = Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(d);

      item.append(value, track, label);
      el.appendChild(item);
    });
  }

  function render(data) {
    const t = data.totals;

    ["totalUsers", "newUsers7d", "newUsers30d", "activeUsers30d", "totalConversations", "totalMessages", "totalPrompts"]
      .forEach(key => $(key).textContent = number(t[key]));

    renderChart("signupChart", data.signupTrend || [], "signup-fill");
    renderChart("promptChart", data.promptTrend || [], "prompt-fill");

    const users = $("recentUsers");
    users.replaceChildren();

    const recent = data.recentUsers || [];

    $("userCountLabel").textContent = `${number(t.totalUsers)} total accounts`;

    if (!recent.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");

      td.colSpan = 3;
      td.className = "muted";
      td.textContent = "No registered accounts found.";

      tr.appendChild(td);
      users.appendChild(tr);

    } else {
      recent.forEach(user => {
        const tr = document.createElement("tr");

        [user.email || "Email unavailable", date(user.createdAt), date(user.lastSignInAt)].forEach(value => {
          const td = document.createElement("td");
          td.textContent = value;
          tr.appendChild(td);
        });

        users.appendChild(tr);
      });
    }

    $("lastUpdated").textContent = `Updated ${new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit" }).format(new Date())}`;
  }

  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();

    $("loginButton").disabled = true;
    setMessage("loginMessage", "Signing in…");

    try {
      const email = $("adminEmail").value.trim();
      const password = $("adminPassword").value;

      const { error } = await client.auth.signInWithPassword({ email, password });

      if (error) throw error;

      $("adminPassword").value = "";
      await loadDashboard();

    } catch (error) {
      setMessage("loginMessage", error.message || "Unable to sign in.", true);

    } finally {
      $("loginButton").disabled = false;
    }
  });

  async function signOut() {
    if (client) await client.auth.signOut();

    $("adminPassword").value = "";
    show("loginPanel");
  }

  $("logoutButton").addEventListener("click", signOut);
  $("deniedLogout").addEventListener("click", signOut);
  $("refreshButton").addEventListener("click", loadDashboard);

  setup();
})();
