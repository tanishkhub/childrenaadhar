import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const api = async (path, options = {}) => {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong.");
  return body;
};
const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });
const date = (value) =>
  new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const urlBase64ToUint8Array = (value) => {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
};
async function shrinkImage(file) {
  const source = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = source;
  });
  const max = 1000;
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}
function Ring({ total = 0, target = 0, size = 152 }) {
  const ratio = target ? Math.min(total / target, 1) : 0;
  const dash = 2 * Math.PI * 56;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 128 128">
        <circle className="ring-track" cx="64" cy="64" r="56" />
        <circle
          className="ring-value"
          cx="64"
          cy="64"
          r="56"
          style={{
            strokeDasharray: dash,
            strokeDashoffset: dash * (1 - ratio),
          }}
        />
      </svg>
      <div>
        <b>{Math.round(ratio * 100)}%</b>
        <small>{money.format(total)}</small>
      </div>
    </div>
  );
}
function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(
        await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page login">
      <div className="brand">
        <div className="mark">♥</div>
        <h1>Children Aadhar Foundation</h1>
        <p>Volunteer collection portal</p>
      </div>
      <section className="card">
        <h2>Welcome back</h2>
        <p className="hint">
          Sign in with the account shared by your coordinator.
        </p>
        <form onSubmit={submit}>
          <label>Email address</label>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label>Password</label>
          <div className="password-field">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <button className="save" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {error && <p className="notice">{error}</p>}
      </section>
      <a className="admin-link login-admin" href="/admin">
        Admin sign in
      </a>
    </main>
  );
}
function Header({ me, page, setPage, logout }) {
  const [open, setOpen] = useState(false);
  return (
    <header>
      <div className="mark">♥</div>
      <div>
        <h1>{page === "home" ? `Hello, ${me.name}` : page}</h1>
        <p>Children Aadhar Foundation</p>
      </div>
      <button
        className="hamburger"
        onClick={() => setOpen(!open)}
        aria-label="Open menu"
      >
        ☰
      </button>
      {open && (
        <nav className="menu">
          <button
            onClick={() => {
              setPage("home");
              setOpen(false);
            }}
          >
            Record donation
          </button>
          <button
            onClick={() => {
              setPage("History");
              setOpen(false);
            }}
          >
            Donation history
          </button>
          <button
            onClick={() => {
              setPage("Daily progress");
              setOpen(false);
            }}
          >
            Daily progress
          </button>
          <button
            onClick={() => {
              setPage("Update target");
              setOpen(false);
            }}
          >
            Set / update target
          </button>
          <button className="signout" onClick={logout}>
            Log out
          </button>
        </nav>
      )}
    </header>
  );
}
function DonationHome({ token, me, refreshMe }) {
  const [type, setType] = useState("cash");
  const [amount, setAmount] = useState("");
  const [image, setImage] = useState("");
  const [today, setToday] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(
    () =>
      JSON.parse(localStorage.getItem("caf-pending-donations") || "[]").length,
  );
  useEffect(() => {
    api("/api/me/progress", { headers: authHeaders(token) })
      .then((x) => setToday(x.today))
      .catch((e) => setNote(e.message));
  }, []);
  useEffect(() => {
    const sync = () => syncQueued();
    window.addEventListener("online", sync);
    sync();
    return () => window.removeEventListener("online", sync);
  }, []);
  async function syncQueued() {
    const pending = JSON.parse(
      localStorage.getItem("caf-pending-donations") || "[]",
    );
    if (!pending.length || !navigator.onLine) return;
    const remaining = [];
    for (const item of pending) {
      try {
        await api("/api/donations", {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify(item),
        });
      } catch {
        remaining.push(item);
      }
    }
    localStorage.setItem("caf-pending-donations", JSON.stringify(remaining));
    setQueued(remaining.length);
    if (!remaining.length) {
      setNote("Offline donations synced successfully.");
      refreshMe();
    }
  }
  async function file(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!["image/jpeg", "image/png"].includes(f.type))
      return setNote("Only JPG, JPEG, and PNG images are allowed.");
    if (f.size > 8 * 1024 * 1024)
      return setNote("Image must be 8 MB or smaller.");
    try {
      setImage(await shrinkImage(f));
      setNote("Receipt image ready.");
    } catch {
      setNote("Could not read this image.");
    }
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setNote("");
    try {
      const data = await api("/api/donations", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ type, amount, receiptImage: image }),
      });
      setToday(data.today);
      setAmount("");
      setImage("");
      setNote("Donation saved — great work!");
      refreshMe();
    } catch (e) {
      if (!navigator.onLine || e.message.includes("Failed to fetch")) {
        const pending = JSON.parse(
          localStorage.getItem("caf-pending-donations") || "[]",
        );
        pending.push({ type, amount, receiptImage: image });
        localStorage.setItem("caf-pending-donations", JSON.stringify(pending));
        setQueued(pending.length);
        setAmount("");
        setImage("");
        setNote(
          "No connection — donation saved safely on this phone and will sync automatically.",
        );
      } else setNote(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function reminders() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        return setNote("To enable reminders, add this app to your home screen first: tap Share → Add to Home Screen, then reopen and try again.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        return setNote("Notification permission was not granted.");
      const { publicKey } = await api("/api/push/public-key", {
        headers: authHeaders(token),
      });
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api("/api/me/push-subscription", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ subscription }),
      });
      setNote(
        "Background reminders are enabled, including when the app is closed.",
      );
    } catch (e) {
      setNote(e.message);
    }
  }
  const total = today?.total || 0;
  const target = me.dailyTarget || 0;
  const phases = [
    Math.round(target * 0.35),
    Math.round(target * 0.3),
    target - Math.round(target * 0.65),
  ];
  return (
    <>
      <section className="card">
        <h2>Record a donation</h2>
        <form onSubmit={save}>
          <label>Collection type</label>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setImage("");
            }}
          >
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
          </select>
          <label>Amount (₹)</label>
          <input
            inputMode="numeric"
            type="number"
            min="1"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 500"
          />
          {type === "upi" && (
            <>
              <label>UPI receipt image</label>
              <p className="hint">JPG / PNG only, maximum 8 MB.</p>
              <div className="upload-options">
                <label className="upload-choice">
                  🖼️ Choose from gallery
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    onChange={file}
                  />
                </label>
                <label className="upload-choice">
                  📷 Take a photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    capture="environment"
                    onChange={file}
                  />
                </label>
              </div>
              <p className="hint gallery-note">
                Whether a new camera photo is also saved to your gallery is
                controlled by your phone and browser.
              </p>
              {image && (
                <img className="preview" src={image} alt="Receipt preview" />
              )}
            </>
          )}
          <button className="save" disabled={busy}>
            {busy ? "Saving…" : "Save donation"}
          </button>
        </form>
        {note && (
          <p
            className={
              note.includes("saved") || note.includes("ready")
                ? "notice good"
                : "notice"
            }
          >
            {note}
          </p>
        )}
        {queued > 0 && (
          <p className="notice">
            {queued} donation{queued > 1 ? "s" : ""} waiting to sync when you
            are online.
          </p>
        )}
      </section>
      <section className="goal-card">
        <Ring total={total} target={target} />
        <div>
          <h2>Today’s mission</h2>
          <b>{money.format(Math.max(0, target - total))} to go</b>
          <p className="hint">Target: {money.format(target)}</p>
          <div className="phase">
            <span>Morning · {money.format(phases[0])}</span>
            <span>Afternoon · {money.format(phases[1])}</span>
            <span>Evening · {money.format(phases[2])}</span>
          </div>
          <button className="tiny" onClick={reminders}>
            Enable reminders
          </button>
        </div>
      </section>
    </>
  );
}
function History({ token }) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [limit, setLimit] = useState(10);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("");
  const load = async (p = page) => {
    const q = new URLSearchParams({ page: p, limit });
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    if (type) q.set("type", type);
    const data = await api(`/api/donations?${q}`, {
      headers: authHeaders(token),
    });
    setItems(data.items);
    setPage(data.page);
    setPages(data.pages);
  };
  useEffect(() => {
    load(1).catch(() => {});
  }, [limit]);
  return (
    <section className="card">
      <h2>Donation history</h2>
      <div className="filters">
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Cash + UPI</option>
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
        </select>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        >
          <option value="10">10 records</option>
          <option value="25">25 records</option>
          <option value="50">50 records</option>
        </select>
        <button onClick={() => load(1)}>Apply</button>
      </div>
      <DonationRows items={items} />
      <div className="pager">
        <button disabled={page === 1} onClick={() => load(page - 1)}>
          ← Previous
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button disabled={page === pages} onClick={() => load(page + 1)}>
          Next →
        </button>
      </div>
    </section>
  );
}
function Progress({ token, me }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api("/api/me/progress", { headers: authHeaders(token) }).then(setData);
  }, []);
  if (!data) return <section className="card">Loading progress…</section>;
  const now = new Date();
  const monthDays = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const startDay = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const byDay = new Map(data.days.map((day) => [day._id, day]));
  const monthLabel = now.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  return (
    <>
      <section className="goal-card">
        <Ring total={data.today.total} target={data.target} />
        <div>
          <h2>
            {data.streak
              ? `${data.streak}-day target streak 🔥`
              : "Start today’s streak"}
          </h2>
          <p className="hint">Hit your daily target to extend your streak.</p>
          <b>{money.format(data.today.total)} collected today</b>
        </div>
      </section>
      <section className="card">
        <h2>{monthLabel}</h2>
        <p className="hint">
          Monthly collection: <b>{money.format(data.monthTotal)}</b> · Green =
          target achieved, red = missed
        </p>
        <div className="calendar">
          {Array.from({ length: startDay }).map((_, index) => (
            <span key={`blank-${index}`} />
          ))}
          {Array.from({ length: monthDays }, (_, index) => {
            const day = index + 1;
            const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const record = byDay.get(key);
            const isPast = day <= now.getDate();
            return (
              <div
                className={`calendar-day ${isPast ? (record?.total >= data.target ? "hit" : "miss") : "future"}`}
                key={key}
              >
                <b>{day}</b>
                <span>{record ? money.format(record.total) : "—"}</span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="card">
        <h2>Last 30 days</h2>
        {data.days.map((d) => (
          <div className="row" key={d._id}>
            <span>
              {d._id}
              <small>{d.count} donations</small>
            </span>
            <b>{money.format(d.total)}</b>
          </div>
        ))}
        {!data.days.length && (
          <p className="hint">
            Your progress will appear here after your first donation.
          </p>
        )}
      </section>
    </>
  );
}
function Target({ token, me, refreshMe }) {
  const [target, setTarget] = useState(me.dailyTarget);
  const [note, setNote] = useState("");
  async function save(e) {
    e.preventDefault();
    try {
      const r = await api("/api/me/target", {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ dailyTarget: target }),
      });
      refreshMe(r.volunteer);
      setNote(
        "Daily target saved. It will automatically carry forward every day.",
      );
    } catch (e) {
      setNote(e.message);
    }
  }
  return (
    <section className="card">
      <h2>Set daily target</h2>
      <p className="hint">Your target stays active until you change it.</p>
      <form onSubmit={save}>
        <label>Daily target (₹)</label>
        <input
          type="number"
          min="0"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          required
        />
        <button className="save">Save target</button>
      </form>
      {note && <p className="notice good">{note}</p>}
    </section>
  );
}
function DonationRows({ items, admin = false, onEdit, onVoid }) {
  const [image, setImage] = useState("");
  return (
    <>
      {items.map((d) => (
        <div className="row" key={d._id}>
          <span>
            {admin && `${d.volunteerName} · `}
            {d.type.toUpperCase()}
            <small>{date(d.collectedAt)}</small>
          </span>
          <span>
            <b>{money.format(d.amount)}</b>
            {admin && d.receiptImage && (
              <button
                className="receipt"
                onClick={() => setImage(d.receiptImage)}
              >
                View receipt
              </button>
            )}
            {admin && d.status !== "void" && (
              <span className="donation-actions">
                <button className="receipt" onClick={() => onEdit?.(d)}>
                  Edit
                </button>
                <button className="receipt void" onClick={() => onVoid?.(d)}>
                  Void
                </button>
              </span>
            )}
          </span>
        </div>
      ))}
      {image && (
        <div className="modal" onClick={() => setImage("")}>
          <img src={image} alt="UPI receipt" />
        </div>
      )}
    </>
  );
}
function VolunteerApp() {
  const [session, setSession] = useState(() =>
    JSON.parse(localStorage.getItem("caf-session") || "null"),
  );
  const [page, setPage] = useState("home");
  const [me, setMe] = useState(session?.volunteer);
  const token = session?.token;
  const refreshMe = async (provided) => {
    if (provided) {
      setMe(provided);
      setSession((s) => {
        const next = { ...s, volunteer: provided };
        localStorage.setItem("caf-session", JSON.stringify(next));
        return next;
      });
    } else {
      const r = await api("/api/me", { headers: authHeaders(token) });
      refreshMe(r.volunteer);
    }
  };
  useEffect(() => {
    if (token)
      refreshMe().catch(() => {
        localStorage.removeItem("caf-session");
        setSession(null);
      });
  }, []);
  if (!session || !me)
    return (
      <Login
        onLogin={(data) => {
          localStorage.setItem("caf-session", JSON.stringify(data));
          setSession(data);
          setMe(data.volunteer);
        }}
      />
    );
  const logout = () => {
    localStorage.removeItem("caf-session");
    setSession(null);
    setMe(null);
  };
  return (
    <main className="page">
      <Header me={me} page={page} setPage={setPage} logout={logout} />
      {page === "home" && (
        <DonationHome token={token} me={me} refreshMe={refreshMe} />
      )}
      {page === "History" && <History token={token} />}
      {page === "Daily progress" && <Progress token={token} me={me} />}
      {page === "Update target" && (
        <Target token={token} me={me} refreshMe={refreshMe} />
      )}
    </main>
  );
}
function Admin() {
  const [token, setToken] = useState(localStorage.getItem("caf-admin") || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [edit, setEdit] = useState(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    dailyTarget: 10000,
  });
  const headers = useMemo(() => authHeaders(token), [token]);
  const load = () => api("/api/admin/dashboard", { headers }).then(setData);
  useEffect(() => {
    if (token) load().catch(() => setToken(""));
  }, [token]);
  async function login(e) {
    e.preventDefault();
    const r = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    localStorage.setItem("caf-admin", r.token);
    setToken(r.token);
  }
  async function add(e) {
    e.preventDefault();
    await api("/api/admin/volunteers", {
      method: "POST",
      headers,
      body: JSON.stringify(form),
    });
    setForm({ name: "", email: "", password: "", dailyTarget: 10000 });
    load();
  }
  async function open(v) {
    setSelected(v);
    setEdit({
      name: v.name,
      email: v.email,
      dailyTarget: v.dailyTarget,
      password: "",
    });
    setDetail(await api(`/api/admin/volunteers/${v.id}/detail`, { headers }));
  }
  async function updateVolunteer(e) {
    e.preventDefault();
    const payload = { ...edit };
    if (!payload.password) delete payload.password;
    const updated = await api(`/api/admin/volunteers/${selected.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(payload),
    });
    await load();
    await open(updated);
  }
  async function deleteVolunteer() {
    if (
      !confirm(
        `Deactivate ${selected.name}'s account? They will no longer be able to sign in.`,
      )
    )
      return;
    await api(`/api/admin/volunteers/${selected.id}`, {
      method: "DELETE",
      headers,
    });
    setSelected(null);
    setDetail(null);
    setEdit(null);
    load();
  }
  async function editDonation(donation) {
    const amount = prompt("Correct amount", donation.amount);
    if (!amount || Number(amount) <= 0) return;
    await api(`/api/admin/donations/${donation._id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ amount }),
    });
    await open(selected);
    load();
  }
  async function voidDonation(donation) {
    const reason = prompt(
      "Reason for voiding this donation",
      "Duplicate or incorrect entry",
    );
    if (reason === null) return;
    await api(`/api/admin/donations/${donation._id}/void`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason }),
    });
    await open(selected);
    load();
  }
  async function exportCsv() {
    const response = await fetch("/api/admin/export", { headers });
    if (!response.ok) return alert("Could not export collections.");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "children-aadhar-collections.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  async function testPush() {
    try {
      const r = await api("/api/admin/test-push", { method: "POST", headers });
      alert(`Test notification sent to ${r.sent} subscription(s).`);
    } catch (e) {
      alert(e.message);
    }
  }
  if (!token)
    return (
      <main className="page login">
        <div className="brand">
          <div className="mark">♥</div>
          <h1>Admin sign in</h1>
        </div>
        <section className="card">
          <form onSubmit={login}>
            <label>Password</label>
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <button className="save">Sign in</button>
          </form>
        </section>
        <a className="admin-link login-admin" href="/">
          ← Back to volunteer login
        </a>
      </main>
    );
  const totals = data?.totals || {};
  return (
    <main className="page admin">
      <header>
        <div className="mark">♥</div>
        <div>
          <h1>Command centre</h1>
          <p>Children Aadhar Foundation</p>
        </div>
        <button
          className="logout"
          onClick={() => {
            localStorage.removeItem("caf-admin");
            setToken("");
          }}
        >
          Log out
        </button>
        <div className="admin-actions">
          <button className="export" onClick={exportCsv}>⬇ Export CSV</button>
          <button className="btn-test" onClick={testPush}>🔔 Test notifications</button>
        </div>
      </header>
      <section className="stats">
        <div>
          <span>Total collection</span>
          <strong>{money.format(totals.total || 0)}</strong>
        </div>
        <div>
          <span>Donations</span>
          <strong>{totals.count || 0}</strong>
        </div>
        <div>
          <span>Cash</span>
          <strong>{money.format(totals.cash || 0)}</strong>
        </div>
        <div>
          <span>UPI</span>
          <strong>{money.format(totals.upi || 0)}</strong>
        </div>
      </section>
         <section className="card">
        <div className="section-header">
          <h2>Today’s volunteer progress</h2>
          <span className="badge-count">{data?.volunteers?.length || 0} volunteers</span>
        </div>
        <input
          className="admin-search"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="volunteer-grid">
          {[...(data?.volunteers || [])]
            .filter((v) =>
              `${v.name} ${v.email}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .sort((a, b) => b.today.total - a.today.total)
            .map((v, index) => {
              const pct = v.dailyTarget ? Math.min(100, Math.round((v.today.total / v.dailyTarget) * 100)) : 0;
              return (
                <button className="admin-volunteer" onClick={() => open(v)} key={v.id}>
                  <div className="admin-volunteer-top">
                    <Ring total={v.today.total} target={v.dailyTarget} size={90} />
                    <span>
                      <span className="vol-rank">#{index + 1}</span>
                      <b>{v.name}</b>
                      <small>{money.format(v.today.total)} / {money.format(v.dailyTarget)}</small>
                      <small>{v.today.count} donation{v.today.count !== 1 ? "s" : ""} today</small>
                    </span>
                  </div>
                  <div className="vol-progress-bar">
                    <div className="vol-progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                </button>
              );
            })}
        </div>
      </section>
      <section className="card">
        <h2>Create volunteer account</h2>
        <form className="account-form" onSubmit={add}>
          {[
            ["name", "Name"],
            ["email", "Email address"],
            ["password", "Temporary password"],
            ["dailyTarget", "Daily target ₹"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type={
                  key === "password"
                    ? "password"
                    : key === "dailyTarget"
                      ? "number"
                      : key === "email"
                        ? "email"
                        : "text"
                }
                min={key === "dailyTarget" ? "0" : undefined}
                required
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <button className="save">Create account</button>
        </form>
      </section>
      {selected && (
        <section className="card detail">
          <button
            className="back-button"
            onClick={() => {
              setSelected(null);
              setDetail(null);
            }}
          >
            ← Back to cards
          </button>
          <h2>{selected.name}</h2>
          {detail ? (
            <>
              <p className="hint">
                {selected.email} · Target {money.format(selected.dailyTarget)}
              </p>
              <h3>Manage account</h3>
              <form
                className="account-form edit-account"
                onSubmit={updateVolunteer}
              >
                <label>
                  Name
                  <input
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                    required
                  />
                </label>
                <label>
                  Email address
                  <input
                    type="email"
                    value={edit.email}
                    onChange={(e) =>
                      setEdit({ ...edit, email: e.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  New password <small>(leave empty to keep current)</small>
                  <input
                    type="password"
                    minLength="6"
                    value={edit.password}
                    onChange={(e) =>
                      setEdit({ ...edit, password: e.target.value })
                    }
                  />
                </label>
                <label>
                  Daily target ₹
                  <input
                    type="number"
                    min="0"
                    value={edit.dailyTarget}
                    onChange={(e) =>
                      setEdit({ ...edit, dailyTarget: e.target.value })
                    }
                    required
                  />
                </label>
                <button className="save">Save changes</button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={deleteVolunteer}
                >
                  Deactivate volunteer
                </button>
              </form>
              <h3>Daily performance</h3>
              {detail.days.map((d) => (
                <div className="row" key={d._id}>
                  <span>
                    {d._id}
                    <small>{d.count} donations</small>
                  </span>
                  <b>{money.format(d.total)}</b>
                </div>
              ))}
              <h3>Collection history</h3>
              <DonationRows
                items={detail.donations}
                admin
                onEdit={editDonation}
                onVoid={voidDonation}
              />
            </>
          ) : (
            <p>Loading…</p>
          )}
        </section>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")).render(
  location.pathname.startsWith("/admin") ? <Admin /> : <VolunteerApp />,
);
