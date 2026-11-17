import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  CalendarDays,
  ChartNoAxesCombined,
  Files,
  Bell,
  ArrowUpRight,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  User,
  LogOut,
  Plus,
  Check,
  CheckCheck,
  X,
  BookOpen,
  ShieldCheck,
  LoaderCircle,
  AlertCircle,
  MessageSquare,
} from "lucide-react";
import "./styles.css";
const icons = {
  home: LayoutDashboard,
  schedule: CalendarDays,
  grades: ChartNoAxesCombined,
  requests: Files,
  notifications: Bell,
  profile: User,
};
const tabs = {
  home: "Главная",
  schedule: "Расписание",
  grades: "Оценки",
  requests: "Заявки",
  notifications: "Входящие",
};
const categoryIcons = {
  schedule: CalendarDays,
  requests: Files,
  deadline: Clock,
  grades: ChartNoAxesCombined,
};
const requestSteps = [
  ["submitted", "Отправлена"],
  ["processing", "В работе"],
  ["ready", "Готова"],
];
function RequestSteps({ status }) {
  if (status === "cancelled") return null;
  const current = requestSteps.findIndex(([s]) => s === status);
  return (
    <span className="req-steps" aria-hidden="true">
      {requestSteps.map(([s], i) => (
        <i key={s} className={i <= current ? "done" : ""} />
      ))}
    </span>
  );
}
const pages = {
  home: "Главная",
  schedule: "Расписание",
  grades: "Успеваемость",
  requests: "Заявки и справки",
  notifications: "Уведомления",
  profile: "Мой профиль",
};
const requestTypes = [
  "Справка об обучении",
  "Справка о стипендии",
  "Заявление на материальную помощь",
  "Обращение в деканат",
];
const statuses = {
  submitted: "Отправлена",
  processing: "В работе",
  ready: "Готова",
  cancelled: "Отменена",
  passed: "Зачтено",
  in_progress: "В процессе",
  attention: "Нужно внимание",
};
const dateKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const pretty = (v, opts = { day: "numeric", month: "long" }) =>
  v
    ? new Date(v.length === 10 ? v + "T12:00:00" : v).toLocaleDateString(
        "ru-RU",
        opts,
      )
    : "—";
const today = dateKey(new Date());
const plural = (n, one, few, many) => n % 100 >= 11 && n % 100 <= 14 ? many : n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
function Mark() {
  return (
    <span className="brand-mark">
      <span />
      <span />
      <span />
    </span>
  );
}
function Badge({ status, children }) {
  return (
    <span className={"badge " + status}>
      {children || statuses[status] || status}
    </span>
  );
}
function Empty({
  title = "Пока ничего нет",
  body = "Новые записи появятся здесь.",
}) {
  return (
    <div className="empty">
      <BookOpen size={28} />
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
const categoryName = (value) =>
  ({
    schedule: "Расписание",
    requests: "Заявки",
    deadline: "Дедлайн",
    news: "Новости",
    grades: "Успеваемость",
    announcement: "Объявление",
  })[value] || value;
function App() {
  const [user, setUser] = useState(null),
    [csrf, setCsrf] = useState(""),
    [boot, setBoot] = useState(true),
    [page, setPage] = useState("home"),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [menu, setMenu] = useState(false),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(false),
    [detail, setDetail] = useState(null),
    [scheduleMode, setScheduleMode] = useState("week"),
    [selectedDate, setSelectedDate] = useState(today);
  async function api(path, method = "GET", body) {
    const r = await fetch("/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      credentials: "same-origin",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let result;
    try {
      result = await r.json();
    } catch {
      throw new Error("Сервер вернул неожиданный ответ. Попробуйте ещё раз.");
    }
    if (!r.ok) {
      if (r.status === 401 && path != "/login") {
        setUser(null);
        setData(null);
        setModal(false);
        setDetail(null);
        setMenu(false);
        setToast("");
        setError("");
      }
      throw new Error(result.error || "Не удалось выполнить запрос");
    }
    return result;
  }
  async function refresh() {
    const d = await api("/dashboard");
    setData(d);
    return d;
  }
  useEffect(() => {
    api("/me")
      .then((d) => {
        setUser(d.user);
        setCsrf(d.csrfToken);
      })
      .catch(() => {})
      .finally(() => setBoot(false));
  }, []);
  useEffect(() => {
    if (user) {
      setError("");
      refresh().catch((e) => setError(e.message));
    }
  }, [user]);
  useEffect(() => {
    if (!modal && !detail) return;
    const previous = document.activeElement;
    const dialog = document.querySelector('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll(
          'button:not(:disabled),input,select,textarea,[tabindex="0"]',
        ),
      );
    const first = focusable()[0];
    if (first) first.focus();
    const handler = (e) => {
      if (e.key === "Escape" && !busy) {
        setModal(false);
        setDetail(null);
        setError("");
      }
      if (e.key === "Tab") {
        const items = focusable();
        if (!items.length) {
          e.preventDefault();
          return;
        }
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    document.body.classList.add("modal-open");
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.classList.remove("modal-open");
      previous?.focus();
    };
  }, [modal, detail, busy]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  function go(p) {
    setPage(p);
    setMenu(false);
    setError("");
    window.scrollTo(0, 0);
  }
  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const d = await api("/login", "POST", {
        login: f.get("login"),
        password: f.get("password"),
      });
      setCsrf(d.csrfToken);
      setModal(false);
      setDetail(null);
      setMenu(false);
      setToast("");
      setUser(d.user);
      setPage("home");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api("/logout", "POST");
      setUser(null);
      setData(null);
      setModal(false);
      setDetail(null);
      setMenu(false);
      setToast("");
      setError("");
      setCsrf("");
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  async function createRequest(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/requests", "POST", {
        type: f.get("type"),
        comment: f.get("comment"),
      });
      await refresh();
      setModal(false);
      go("requests");
      setToast("Заявка отправлена. Её статус появится здесь.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function cancelRequest(id) {
    setBusy(true);
    try {
      const r = await api(`/requests/${id}/cancel`, "POST");
      setDetail(r.item);
      await refresh();
      setToast("Заявка отменена");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function readNotification(n) {
    try {
      await api(`/notifications/${n.id}/read`, "POST");
      await refresh();
      if (n.action) go(n.action);
    } catch (e) {
      setError(e.message);
    }
  }
  if (boot)
    return (
      <div className="full-loader">
        <Mark />
        <LoaderCircle className="spin" />
        <p>Загрузка…</p>
      </div>
    );
  if (!user)
    return (
      <div className="login-layout">
        <div className="login-story">
          <a className="brand" href="#">
            <Mark />
            разумист<span className="brand-dot">.</span>
          </a>
          <h1>
            Расписание, оценки и справки — <em>в одном окне.</em>
          </h1>
          <p>
            Личный кабинет студента Университета Северного Горизонта:
            ближайшая пара, баллы до сессии и статус заявок в деканат.
          </p>
          <div className="concept">
            <ShieldCheck size={17} /> Конкурсный концепт · Только вымышленные
            данные
          </div>
        </div>
        <main className="login-main">
          <h2>Вход в кабинет</h2>
          <form onSubmit={login} className="login-form">
            <label>
              Логин
              <input
                name="login"
                autoComplete="username"
                required
                placeholder="Твой логин"
              />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="Введи пароль"
              />
            </label>
            {error && (
              <div role="alert" className="error">
                <AlertCircle size={18} />
                {error}
              </div>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  Войти в кабинет
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="demo-box">
            <div>
              <span className="demo-label">Демо-аккаунты</span>
              <span className="muted small">
                Два студента с разными данными
              </span>
            </div>
            <div className="demo-buttons">
              {[
                ["alina", "Алина", "А"],
                ["mark", "Марк", "М"],
              ].map(([id, name, initial]) => (
                <button
                  key={id}
                  onClick={() => {
                    const f = document.querySelector(".login-form");
                    f.elements.login.value = id;
                    f.elements.password.value = "Campus2026!";
                    f.requestSubmit();
                  }}
                  disabled={busy}
                >
                  <span className="avatar small-avatar">{initial}</span>
                  {name}
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
            <p className="small muted">
              Логины: <code>alina</code>, <code>mark</code>
              <br />
              Демо-пароль: <code>Campus2026!</code>
            </p>
          </div>
          <p className="login-foot">
            Университет Северного Горизонта
            <br />
            Не является официальным сервисом вуза
          </p>
        </main>
      </div>
    );
  const schedule = data?.schedule || [],
    grades = data?.grades || [],
    requests = data?.requests || [],
    notifications = data?.notifications || [];
  const unread = notifications.filter((n) => !n.read).length,
    activeRequests = requests.filter(
      (r) => !["cancelled", "ready"].includes(r.status),
    );
  const sortedSchedule = [...schedule].sort((a, b) =>
    (a.date + a.start).localeCompare(b.date + b.start),
  );
  const todays = sortedSchedule.filter((s) => s.date === today),
    next = sortedSchedule.find(
      (s) =>
        s.date > today ||
        (s.date === today && s.end > new Date().toTimeString().slice(0, 5)),
    );
  const average = grades.length
    ? Math.round(
        grades.reduce((s, g) => s + (g.score / g.maxScore) * 100, 0) /
          grades.length,
      )
    : 0;
  const passedCount = grades.filter((g) => g.status === "passed").length,
    atRisk = grades.filter((g) => g.status === "attention");
  const firstExam = grades
    .map((g) => g.examDate)
    .filter((d) => d && d >= today)
    .sort()[0];
  const daysToSession = firstExam
    ? Math.round(
        (new Date(firstExam + "T12:00:00") - new Date(today + "T12:00:00")) /
          864e5,
      )
    : null;
  async function openRequest(id) {
    try {
      const d = await api("/requests/" + id);
      setError("");
      setDetail(d.item);
    } catch (e) {
      setError(e.message);
    }
  }
  const attention = [
    ...sortedSchedule
      .filter((s) => s.changed && s.date >= today)
      .map((s) => ({
        key: "c" + s.id,
        icon: CalendarDays,
        tone: "warn",
        title: `${s.subject}: ${s.changeNote || "изменение в расписании"}`,
        meta: `${pretty(s.date, { weekday: "short", day: "numeric", month: "short" })}, ${s.start}`,
        onClick: () => {
          setSelectedDate(s.date);
          setScheduleMode("day");
          go("schedule");
        },
      })),
    ...atRisk.map((g) => ({
      key: "g" + g.id,
      icon: ChartNoAxesCombined,
      tone: "warn",
      title: `${g.subject} — ${g.score} из ${g.maxScore}`,
      meta: `${g.assessment} ${pretty(g.examDate)}`,
      onClick: () => go("grades"),
    })),
    ...requests
      .filter((r) => r.status === "ready")
      .map((r) => ({
        key: "r" + r.id,
        icon: Files,
        tone: "ok",
        title: `${r.type} — готова`,
        meta: `Заявка № ${r.id}`,
        onClick: () => openRequest(r.id),
      })),
    ...notifications
      .filter((n) => !n.read && !["schedule", "requests"].includes(n.category))
      .map((n) => ({
        key: "n" + n.id,
        icon: categoryIcons[n.category] || Bell,
        tone: "info",
        title: n.title,
        meta: `${categoryName(n.category)} · ${pretty(n.createdAt)}`,
        onClick: () => readNotification(n),
      })),
  ];
  const homeRequests = requests
    .filter((r) => r.status !== "cancelled")
    .slice(0, 3);
  const name = user.name.split(" ")[0],
    initials = user.name
      .split(" ")
      .slice(0, 2)
      .map((x) => x[0])
      .join("");
  const dayDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + i);
    return dateKey(d);
  });
  function shiftWeek(n) {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + n * 7);
    setSelectedDate(dateKey(d));
  }
  function scheduleRow(s) {
    return (
      <div className={"class-row " + (s.changed ? "changed" : "")} key={s.id}>
        <div className="class-time">
          <strong>{s.start}</strong>
          <span>{s.end}</span>
        </div>
        <div className="class-info">
          <span className="class-type">{s.type}</span>
          <h3>{s.subject}</h3>
          <div className="class-meta">
            <span>
              <MapPin size={14} />
              {s.room}
            </span>
            <span>
              <User size={14} />
              {s.teacher}
            </span>
          </div>
          {s.changed && (
            <div className="change-note">
              <AlertCircle size={14} />
              {s.changeNote || "В расписании есть изменение"}
            </div>
          )}
        </div>
        {s.changed && <span className="change-dot" title="Изменение" />}
      </div>
    );
  }
  function requestRow(r) {
    return (
      <button
        className="request-row"
        key={r.id}
        onClick={() => openRequest(r.id)}
      >
        <span className="file-icon">
          <Files size={20} />
        </span>
        <span className="request-name">
          <strong>{r.type}</strong>
          <span>
            № {r.id} · {pretty(r.createdAt)}
          </span>
          <RequestSteps status={r.status} />
        </span>
        <Badge status={r.status} />
        <ChevronRight size={18} />
      </button>
    );
  }
  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        К содержимому
      </a>
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            go("home");
          }}
        >
          <Mark />
          разумист<span className="brand-dot">.</span>
        </a>
        <nav aria-label="Разделы">
          {Object.entries(pages).map(([key, title]) => {
            const Icon = icons[key];
            return (
              <button
                key={key}
                onClick={() => go(key)}
                className={page === key ? "nav-item active" : "nav-item"}
                aria-current={page === key ? "page" : undefined}
              >
                <Icon size={19} />
                {title}
                {key === "notifications" && unread > 0 && (
                  <span className="nav-count">{unread}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">{initials}</span>
          <div>
            <strong>{name}</strong>
            <span>
              {user.group} · {user.year} курс
            </span>
          </div>
          <button
            className="icon-button"
            aria-label="Выйти из аккаунта"
            onClick={logout}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <a
            href="#"
            className="topbar-brand"
            onClick={(e) => {
              e.preventDefault();
              go("home");
            }}
          >
            <Mark />
            разумист
          </a>
          <div className="topbar-right">
            <span className="concept-tag">КОНЦЕПТ</span>
            <button
              className="notification-button icon-button"
              aria-label={`Уведомления, ${unread} непрочитанных`}
              onClick={() => go("notifications")}
            >
              <Bell size={20} />
              {unread > 0 && <i />}
            </button>
            <button
              className="avatar avatar-button"
              aria-label="Открыть профиль"
              onClick={() => go("profile")}
            >
              {initials}
            </button>
          </div>
        </header>
        <main id="main-content" className="main">
          <div className="page-heading">
            <div>
              {page === "home" && (
                <span className="eyebrow">
                  {pretty(today, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </span>
              )}
              <h1>{page === "home" ? `Привет, ${name}` : pages[page]}</h1>
              {page === "home" && data && (
                <p>
                  {user.group} ·{" "}
                  {todays.length
                    ? `сегодня ${todays.length} ${plural(todays.length, "пара", "пары", "пар")}`
                    : "сегодня пар нет"}
                  {daysToSession !== null &&
                    ` · до сессии ${daysToSession} ${plural(daysToSession, "день", "дня", "дней")}`}
                </p>
              )}
            </div>
            {page === "requests" && (
              <button
                className="primary"
                onClick={() => {
                  setError("");
                  setModal(true);
                }}
              >
                <Plus size={18} />
                Новая заявка
              </button>
            )}
          </div>
          {error && !modal && (
            <div className="error" role="alert">
              <AlertCircle size={18} />
              {error}
              <button
                onClick={() =>
                  refresh()
                    .then(() => setError(""))
                    .catch((e) => setError(e.message))
                }
              >
                Повторить
              </button>
            </div>
          )}
          {!data ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              Загружаем твой кабинет…
            </div>
          ) : (
            <>
              {page === "home" && (
                <>
                  <div className="hero-grid">
                    <section className={"next-class" + (next?.changed ? " has-change" : "")}>
                      <div className="next-top">
                        <span className="light-label">
                          {next
                            ? next.date === today
                              ? "Следующая пара · сегодня"
                              : "Следующая пара · " +
                                pretty(next.date, { weekday: "long", day: "numeric", month: "long" })
                            : "Следующая пара"}
                        </span>
                      </div>
                      <div className="next-main">
                        {next && (
                          <div className="next-time">
                            <strong>{next.start}</strong>
                            <span>{next.end}</span>
                          </div>
                        )}
                        <div>
                          <h2>
                            {next ? next.subject : "На этой неделе пар больше нет"}
                          </h2>
                          <p>
                            {next
                              ? `${next.room} · ${next.type} · ${next.teacher}`
                              : "Расписание следующей недели — в разделе «Расписание»."}
                          </p>
                        </div>
                      </div>
                      {next?.changed && (
                        <div className="next-change">
                          <AlertCircle size={16} />
                          {next.changeNote || "В расписании есть изменение"}
                        </div>
                      )}
                      <div className="next-bottom">
                        <button
                          className="next-link"
                          onClick={() => go("schedule")}
                        >
                          Расписание
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </section>
                    <section className="study-card">
                      <span className="eyebrow">Сессия</span>
                      <div className="progress-value">
                        {daysToSession !== null ? (
                          <>
                            {daysToSession}
                            <span>{plural(daysToSession, "день", "дня", "дней")} до первой аттестации</span>
                          </>
                        ) : (
                          <span>Даты аттестаций пока не назначены</span>
                        )}
                      </div>
                      <progress
                        className="progress-track"
                        value={passedCount}
                        max={grades.length || 1}
                        aria-label="Закрыто дисциплин"
                      />
                      <p>
                        Закрыто {passedCount} из {grades.length}
                        {atRisk.length > 0 && (
                          <>
                            {" · "}
                            <strong className="risk-text">
                              {atRisk.length} под угрозой
                            </strong>
                          </>
                        )}
                      </p>
                      <button
                        className="text-button"
                        onClick={() => go("grades")}
                      >
                        Все оценки
                        <ArrowRight size={16} />
                      </button>
                    </section>
                  </div>
                  <div className="dashboard-columns">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>
                          Требует внимания
                          {attention.length > 0 && (
                            <span className="count-chip">{attention.length}</span>
                          )}
                        </h2>
                      </div>
                      {attention.map((a) => {
                        const Icon = a.icon;
                        return (
                          <button
                            key={a.key}
                            className="action-item"
                            onClick={a.onClick}
                          >
                            <span className={"action-icon " + a.tone}>
                              <Icon size={18} />
                            </span>
                            <span className="action-text">
                              <strong>{a.title}</strong>
                              <span>{a.meta}</span>
                            </span>
                            <ChevronRight size={18} />
                          </button>
                        );
                      })}
                      {!attention.length && (
                        <Empty
                          title="Всё под контролем"
                          body="Изменений, долгов и непрочитанных объявлений нет."
                        />
                      )}
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Мои заявки</h2>
                        <button
                          className="text-button"
                          onClick={() => {
                            setError("");
                            setModal(true);
                          }}
                        >
                          <Plus size={16} />
                          Новая
                        </button>
                      </div>
                      {homeRequests.map(requestRow)}
                      {!homeRequests.length && (
                        <Empty
                          title="Заявок нет"
                          body="Справку или заявление можно заказать здесь же."
                        />
                      )}
                      {requests.length > homeRequests.length && (
                        <button
                          className="panel-more"
                          onClick={() => go("requests")}
                        >
                          Все заявки ({requests.length})
                          <ArrowRight size={16} />
                        </button>
                      )}
                    </section>
                  </div>
                  {todays.length > 0 && (
                    <section className="panel today-panel">
                      <div className="panel-heading">
                        <h2>
                          Сегодня
                          <span className="count-chip">{todays.length}</span>
                        </h2>
                        <button
                          className="text-button"
                          onClick={() => go("schedule")}
                        >
                          Вся неделя
                          <ArrowRight size={16} />
                        </button>
                      </div>
                      {todays.map(scheduleRow)}
                    </section>
                  )}
                </>
              )}
              {page === "schedule" && (
                <>
                  <section className="panel schedule-panel">
                    <div className="schedule-controls">
                      <div className="week-controls">
                        <button
                          className="icon-button"
                          aria-label="Предыдущая неделя"
                          onClick={() => shiftWeek(-1)}
                        >
                          <ChevronLeft size={20} />
                        </button>
                        <strong>
                          {pretty(dayDates[0], {
                            day: "numeric",
                            month: "short",
                          })}{" "}
                          —{" "}
                          {pretty(dayDates[6], {
                            day: "numeric",
                            month: "short",
                          })}
                        </strong>
                        <button
                          className="icon-button"
                          aria-label="Следующая неделя"
                          onClick={() => shiftWeek(1)}
                        >
                          <ChevronRight size={20} />
                        </button>
                      </div>
                      <div className="schedule-actions">
                        <button
                          className="text-button"
                          onClick={() => {
                            setSelectedDate(today);
                            setScheduleMode("day");
                          }}
                        >
                          Сегодня
                        </button>
                        <div className="segmented">
                          <button
                            className={scheduleMode === "day" ? "selected" : ""}
                            onClick={() => setScheduleMode("day")}
                          >
                            День
                          </button>
                          <button
                            className={
                              scheduleMode === "week" ? "selected" : ""
                            }
                            onClick={() => setScheduleMode("week")}
                          >
                            Неделя
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="week-days">
                      {dayDates.map((d) => (
                        <button
                          key={d}
                          className={
                            (d === selectedDate ? "selected " : "") +
                            (d === today ? "today" : "")
                          }
                          onClick={() => {
                            setSelectedDate(d);
                            setScheduleMode("day");
                          }}
                        >
                          <span>{pretty(d, { weekday: "short" })}</span>
                          <strong>{pretty(d, { day: "numeric" })}</strong>
                          <i
                            className={
                              schedule.some((s) => s.date === d)
                                ? "has-classes"
                                : ""
                            }
                          />
                        </button>
                      ))}
                    </div>
                    {(scheduleMode === "day"
                      ? [selectedDate]
                      : dayDates.filter((d) =>
                          schedule.some((s) => s.date === d),
                        )
                    ).map((d) => (
                      <div className="schedule-day" key={d}>
                        {scheduleMode === "week" && (
                          <h2 className="day-heading">
                            {pretty(d, {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                            })}
                            {d === today && (
                              <Badge status="passed">Сегодня</Badge>
                            )}
                          </h2>
                        )}
                        {sortedSchedule
                          .filter((s) => s.date === d)
                          .map(scheduleRow)}
                        {!schedule.some((s) => s.date === d) && (
                          <Empty
                            title="Свободный день"
                            body="На эту дату занятия не запланированы."
                          />
                        )}
                      </div>
                    ))}
                    {scheduleMode === "week" &&
                      !schedule.some((s) => dayDates.includes(s.date)) && (
                        <Empty
                          title="На этой неделе пока нет занятий"
                          body="Вернись к текущей неделе или проверь расписание позднее."
                        />
                      )}
                  </section>
                  <p className="section-hint">
                    <AlertCircle size={15} />
                    Изменённые занятия отмечены жёлтым. Все даты и преподаватели
                    — демонстрационные.
                  </p>
                </>
              )}
              {page === "grades" && (
                <>
                  <div className="grade-summary">
                    <div className="panel summary-tile">
                      <span className="eyebrow">СРЕДНИЙ РЕЗУЛЬТАТ</span>
                      <strong>
                        {average}
                        <small> / 100</small>
                      </strong>
                      <p>По всем дисциплинам семестра</p>
                    </div>
                    <div className="panel summary-tile">
                      <span className="eyebrow">ДИСЦИПЛИНЫ ЗАКРЫТЫ</span>
                      <strong>
                        {grades.filter((g) => g.status === "passed").length}
                        <small> / {grades.length}</small>
                      </strong>
                      <p>Зачёты и экзамены текущего семестра</p>
                    </div>
                    <div className="panel summary-tile attention-tile">
                      <span className="eyebrow">НУЖНО ВНИМАНИЕ</span>
                      <strong>
                        {grades.filter((g) => g.status === "attention").length}
                      </strong>
                      <p>Дисциплины, где не хватает баллов</p>
                    </div>
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Текущий семестр</h2>
                      <span className="muted small">
                        Балльно-рейтинговая система
                      </span>
                    </div>
                    <div className="grades-list">
                      {grades.map((g) => (
                        <div className="grade-row" key={g.id}>
                          <div className="grade-subject">
                            <h3>{g.subject}</h3>
                            <p>{g.teacher}</p>
                          </div>
                          <div className="grade-progress">
                            <strong>
                              {g.score}
                              <span> / {g.maxScore}</span>
                            </strong>
                            <progress
                              className={"progress-track " + g.status}
                              value={g.score}
                              max={g.maxScore}
                              aria-label={g.subject + " — прогресс"}
                            />
                          </div>
                          <Badge status={g.status} />
                          <div className="grade-exam">
                            <span>{g.assessment}</span>
                            <strong>{pretty(g.examDate)}</strong>
                          </div>
                        </div>
                      ))}
                    </div>
                    {!grades.length && <Empty title="Оценок пока нет" />}
                  </section>
                  <div className="info-note">
                    <MessageSquare size={20} />
                    <div>
                      <strong>Не согласен с баллами?</strong>
                      <p>
                        Отправь обращение в деканат — ответ появится в разделе
                        «Заявки».
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setModal(true)}
                    >
                      Написать
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )}
              {page === "requests" && (
                <>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>
                        Мои заявки
                        <span className="count-chip">{requests.length}</span>
                      </h2>
                    </div>
                    {requests.map(requestRow)}
                    {!requests.length && (
                      <Empty
                        title="Здесь будут твои заявки"
                        body="Создай первое обращение — оно сохранится в кабинете."
                      />
                    )}
                  </section>
                  <p className="section-hint">
                    <ShieldCheck size={16} />
                    Это прототип. Заявки сохраняются локально; реальные
                    документы не выдаются.
                  </p>
                </>
              )}
              {page === "notifications" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      Входящие<span className="count-chip">{unread} новых</span>
                    </h2>
                  </div>
                  {notifications.map((n) => {
                    const NIcon = categoryIcons[n.category] || Bell;
                    return (
                    <article
                      className={
                        "notification-card " + (!n.read ? "unread" : "")
                      }
                      key={n.id}
                    >
                      <span
                        className={
                          "action-icon " +
                          (["schedule", "deadline"].includes(n.category)
                            ? "warn"
                            : n.category === "requests"
                              ? "ok"
                              : "info")
                        }
                      >
                        <NIcon size={18} />
                      </span>
                      <div>
                        <div className="notification-meta">
                          <span>{categoryName(n.category)}</span>
                          <time>{pretty(n.createdAt)}</time>
                          {!n.read && <Badge status="passed">Новое</Badge>}
                        </div>
                        <h3>{n.title}</h3>
                        <p>{n.body}</p>
                        <button
                          className="text-button"
                          onClick={() => readNotification(n)}
                        >
                          {n.action
                            ? "Открыть раздел"
                            : n.read
                              ? "Прочитано"
                              : "Отметить прочитанным"}
                          {n.action ? (
                            <ArrowUpRight size={15} />
                          ) : (
                            <CheckCheck size={15} />
                          )}
                        </button>
                      </div>
                    </article>
                    );
                  })}
                  {!notifications.length && (
                    <Empty
                      title="Ничего не пропущено"
                      body="Объявления деканата появятся здесь."
                    />
                  )}
                </section>
              )}
              {page === "profile" && (
                <>
                  <section className="panel profile-panel">
                    <div className="profile-cover">
                      <span className="avatar profile-avatar">{initials}</span>
                      <div>
                        <h2>{user.name}</h2>
                        <p>
                          {user.group} · {user.year} курс
                        </p>
                      </div>
                    </div>
                    <dl className="profile-fields">
                      {[
                        ["Факультет", user.faculty],
                        ["Направление", user.program],
                        ["Курс", user.year],
                        ["Группа", user.group],
                        ["Номер студенческого", user.studentNumber],
                        ["Почта", user.email],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                  <div className="info-note">
                    <ShieldCheck size={24} />
                    <div>
                      <strong>Твой кабинет — только твой</strong>
                      <p>
                        Профиль, оценки и обращения доступны только после входа.
                        Все данные в прототипе вымышлены.
                      </p>
                    </div>
                  </div>
                  <button className="secondary" onClick={logout}>
                    <LogOut size={17} />
                    Выйти из аккаунта
                  </button>
                </>
              )}
            </>
          )}
          <footer className="main-footer">
            <span>
              <Mark />
              разумист
            </span>
            <p>
              Конкурсный прототип · Неофициальный сервис · Все данные вымышлены
            </p>
          </footer>
        </main>
      </div>
      <nav className="tabbar" aria-label="Разделы">
        {Object.entries(tabs).map(([key, title]) => {
          const Icon = icons[key];
          return (
            <button
              key={key}
              onClick={() => go(key)}
              className={page === key ? "active" : ""}
              aria-current={page === key ? "page" : undefined}
            >
              <span className="tab-icon">
                <Icon size={22} />
                {key === "notifications" && unread > 0 && (
                  <span className="tab-count">{unread}</span>
                )}
              </span>
              {title}
            </button>
          );
        })}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Check size={19} />
          {toast}
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-title"
          >
            <div className="panel-heading">
              <h2 id="request-title">Новая заявка</h2>
              <button
                className="icon-button"
                aria-label="Закрыть форму"
                disabled={busy}
                onClick={() => {
                  setModal(false);
                  setError("");
                }}
              >
                <X />
              </button>
            </div>
            <p className="muted">
              Заявка сохранится в демонстрационном кабинете. Статус можно
              проверить в разделе заявок.
            </p>
            <form onSubmit={createRequest}>
              <label>
                Что тебе нужно?
                <select name="type" required autoFocus>
                  {requestTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>
                  Комментарий <span className="muted">· необязательно</span>
                </span>
                <textarea
                  name="comment"
                  rows={4}
                  maxLength={2000}
                  placeholder="Уточни, для чего нужен документ, или опиши вопрос"
                />
              </label>
              <p className="small muted">
                Не указывай реальные персональные данные. Это демонстрационный
                сервис.
              </p>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <button className="primary wide" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <>
                    Отправить заявку
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
          </section>
        </div>
      )}
      {detail && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetail(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="detail-title"
          >
            <div className="panel-heading">
              <span className="eyebrow">ЗАЯВКА № {detail.id}</span>
              <button
                className="icon-button"
                aria-label="Закрыть заявку"
                onClick={() => setDetail(null)}
              >
                <X />
              </button>
            </div>
            <h2 id="detail-title">{detail.type}</h2>
            <Badge status={detail.status} />
            {detail.comment && (
              <p className="request-comment">{detail.comment}</p>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <h3 className="history-title">История обращения</h3>
            <ol className="timeline">
              {detail.history?.map((h, i) => (
                <li key={i}>
                  <strong>{statuses[h.status] || h.status}</strong>
                  <span>
                    {pretty(h.date, {
                      day: "numeric",
                      month: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <p>{h.note}</p>
                </li>
              ))}
            </ol>
            {detail.status === "ready" && (
              <div className="info-note small">
                Документ готов в демонстрационном сценарии. Реальная справка не
                выдаётся.
              </div>
            )}
            {["submitted", "processing"].includes(detail.status) && (
              <button
                className="secondary danger"
                disabled={busy}
                onClick={() => cancelRequest(detail.id)}
              >
                Отменить заявку
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
