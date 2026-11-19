// Разумист — локальный конкурсный прототип. Все данные вымышлены.
package main

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	_ "modernc.org/sqlite"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type object = map[string]any
type app struct {
	db           *sql.DB
	static       string
	mu           sync.Mutex
	attempts     map[string][]time.Time
	loopbackOnly bool
	publicOrigin string
	recordMu     sync.Mutex
}
type session struct {
	hash    string
	uid     int
	csrf    string
	profile object
}

const iterations = 600000

var types = map[string]bool{"Справка об обучении": true, "Справка о стипендии": true, "Заявление на материальную помощь": true, "Обращение в деканат": true}

func stamp() string { return time.Now().UTC().Format(time.RFC3339) }
func token() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func digest(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func hashPassword(password, salt string) string {
	b, _ := hex.DecodeString(salt)
	key, err := pbkdf2.Key(sha256.New, password, b, iterations, 32)
	if err != nil {
		panic(err)
	}
	return hex.EncodeToString(key)
}
func encode(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}
func decode(s string) object { v := object{}; _ = json.Unmarshal([]byte(s), &v); return v }
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, s string) { respond(w, status, object{"error": s}) }
func readBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		fail(w, 400, "Ожидается JSON")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	defer r.Body.Close()
	d := json.NewDecoder(r.Body)
	if d.Decode(v) != nil {
		fail(w, 400, "Некорректный формат запроса")
		return false
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		fail(w, 400, "Некорректный формат запроса")
		return false
	}
	return true
}
func (a *app) insert(uid int, kind string, p object) (object, error) {
	res, e := a.db.Exec("INSERT INTO records(user_id,kind,payload) VALUES(?,?,?)", uid, kind, encode(p))
	if e != nil {
		return nil, e
	}
	id, e := res.LastInsertId()
	p["id"] = id
	return p, e
}
func (a *app) list(uid int, kind string) ([]object, error) {
	rows, e := a.db.Query("SELECT id,payload FROM records WHERE user_id=? AND kind=? ORDER BY id DESC", uid, kind)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []object{}
	for rows.Next() {
		var id int
		var data string
		if e = rows.Scan(&id, &data); e != nil {
			return nil, e
		}
		p := decode(data)
		p["id"] = id
		out = append(out, p)
	}
	return out, rows.Err()
}
func (a *app) item(uid, id int, kind string) (object, error) {
	var data string
	e := a.db.QueryRow("SELECT payload FROM records WHERE user_id=? AND id=? AND kind=?", uid, id, kind).Scan(&data)
	if e != nil {
		return nil, e
	}
	p := decode(data)
	p["id"] = id
	return p, nil
}
func (a *app) save(uid, id int, p object) error {
	_, e := a.db.Exec("UPDATE records SET payload=? WHERE id=? AND user_id=?", encode(p), id, uid)
	return e
}
func (a *app) current(r *http.Request) (session, error) {
	c, e := r.Cookie("session")
	if e != nil || len(c.Value) != 64 {
		return session{}, errors.New("no session")
	}
	s := session{hash: digest(c.Value)}
	var raw string
	e = a.db.QueryRow("SELECT s.user_id,s.csrf,u.profile FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?", s.hash, time.Now().Unix()).Scan(&s.uid, &s.csrf, &raw)
	s.profile = decode(raw)
	return s, e
}
func (a *app) secureCookie(r *http.Request) bool { return a.publicOrigin != "" || r.TLS != nil }
func (a *app) sameOrigin(r *http.Request) bool {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	expected := scheme + "://" + r.Host
	if a.publicOrigin != "" {
		expected = a.publicOrigin
	}
	return r.Header.Get("Sec-Fetch-Site") != "cross-site" && (r.Header.Get("Origin") == "" || r.Header.Get("Origin") == expected)
}
func (a *app) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if a.loopbackOnly && a.publicOrigin == "" {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		ip := net.ParseIP(host)
		if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			fail(w, 403, "Недопустимый адрес локального сервера")
			return
		}
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "same-origin")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		a.staticFile(w, r)
		return
	}
	if r.URL.Path == "/api/login" && r.Method == "POST" {
		a.login(w, r)
		return
	}
	s, e := a.current(r)
	if e != nil {
		fail(w, 401, "Войдите в личный кабинет")
		return
	}
	if r.Method != "GET" && r.Method != "POST" {
		fail(w, 405, "Метод не поддерживается")
		return
	}
	if r.Method == "POST" && (!a.sameOrigin(r) || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(s.csrf)) != 1) {
		fail(w, 403, "Проверка безопасности не пройдена. Обновите страницу.")
		return
	}
	path := r.URL.Path
	switch {
	case path == "/api/me" && r.Method == "GET":
		respond(w, 200, object{"user": s.profile, "csrfToken": s.csrf})
	case path == "/api/logout" && r.Method == "POST":
		if _, e = a.db.Exec("DELETE FROM sessions WHERE token_hash=?", s.hash); e != nil {
			a.internal(w, e)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "session", Value: "", Path: "/", HttpOnly: true, Secure: a.secureCookie(r), SameSite: http.SameSiteLaxMode, MaxAge: -1})
		respond(w, 200, object{"ok": true})
	case path == "/api/schedule" && r.Method == "GET":
		week := time.Now().In(moscow)
		if raw := r.URL.Query().Get("week"); raw != "" {
			var err error
			week, err = time.ParseInLocation("2006-01-02", raw, moscow)
			if err != nil || week.Year() < 2000 || week.Year() > 2100 {
				fail(w, 400, "Неделя должна быть датой ГГГГ-ММ-ДД с 2000 по 2100 год")
				return
			}
		}
		respond(w, 200, object{"items": scheduleWeek(s.uid, week), "weekStart": weekMonday(week).Format("2006-01-02"), "timeZone": "Europe/Moscow"})
	case path == "/api/dashboard" && r.Method == "GET":
		now := time.Now().In(moscow)
		out := object{"schedule": append(scheduleWeek(s.uid, now), scheduleWeek(s.uid, now.AddDate(0, 0, 7))...), "timeZone": "Europe/Moscow"}
		for _, k := range []string{"grades", "requests", "notifications"} {
			items, err := a.list(s.uid, k)
			if err != nil {
				a.internal(w, err)
				return
			}
			out[k] = items
		}
		respond(w, 200, out)
	case (path == "/api/grades" || path == "/api/requests" || path == "/api/notifications") && r.Method == "GET":
		items, err := a.list(s.uid, strings.TrimPrefix(path, "/api/"))
		if err != nil {
			a.internal(w, err)
			return
		}
		respond(w, 200, object{"items": items})
	case path == "/api/requests" && r.Method == "POST":
		var b struct {
			Type    string `json:"type"`
			Comment string `json:"comment"`
		}
		if !readBody(w, r, &b) {
			return
		}
		if !types[b.Type] || len([]rune(b.Comment)) > 2000 {
			fail(w, 400, "Выберите тип заявки; комментарий — не более 2000 символов")
			return
		}
		date := stamp()
		p, err := a.insert(s.uid, "requests", object{"type": b.Type, "comment": strings.TrimSpace(b.Comment), "status": "submitted", "createdAt": date, "updatedAt": date, "history": []object{{"status": "submitted", "date": date, "note": "Заявка сохранена. Это учебный прототип: обработка сотрудником не подключена."}}})
		if err != nil {
			a.internal(w, err)
			return
		}
		respond(w, 201, object{"item": p})
	default:
		a.recordRoute(w, r, s)
	}
}
func (a *app) internal(w http.ResponseWriter, e error) {
	log.Printf("Database operation failed: %v", e)
	fail(w, 500, "Не удалось выполнить запрос. Попробуйте ещё раз.")
}
func (a *app) recordRoute(w http.ResponseWriter, r *http.Request, s session) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 || len(parts) > 4 {
		fail(w, 404, "Раздел не найден")
		return
	}
	id, e := strconv.Atoi(parts[2])
	if e != nil || id < 1 {
		fail(w, 404, "Запись не найдена")
		return
	}
	kind := parts[1]
	if kind != "requests" && kind != "notifications" {
		fail(w, 404, "Раздел не найден")
		return
	}
	// Serialize transitions so concurrent demo/cancel calls cannot overwrite history.
	a.recordMu.Lock()
	defer a.recordMu.Unlock()
	p, e := a.item(s.uid, id, kind)
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "Запись не найдена")
		return
	}
	if e != nil {
		a.internal(w, e)
		return
	}
	if kind == "requests" && len(parts) == 3 && r.Method == "GET" {
		respond(w, 200, object{"item": p})
		return
	}
	if kind == "requests" && len(parts) == 4 && parts[3] == "cancel" && r.Method == "POST" {
		if p["status"] != "submitted" && p["status"] != "processing" {
			fail(w, 409, "Эту заявку уже нельзя отменить")
			return
		}
		date := stamp()
		p["status"] = "cancelled"
		p["updatedAt"] = date
		history, _ := p["history"].([]any)
		p["history"] = append(history, object{"status": "cancelled", "date": date, "note": "Отменено студентом"})
		if e = a.save(s.uid, id, p); e != nil {
			a.internal(w, e)
			return
		}
		respond(w, 200, object{"item": p})
		return
	}
	if kind == "requests" && len(parts) == 4 && parts[3] == "demo-advance" && r.Method == "POST" {
		next, note := "", ""
		switch p["status"] {
		case "submitted":
			next, note = "processing", "Демонстрация: заявка принята в обработку. Реальный сотрудник не подключён."
		case "processing":
			next, note = "ready", "Демонстрация: обработка завершена. Реальный документ не выдаётся."
		default:
			fail(w, 409, "Демонстрационная обработка этой заявки завершена или отменена")
			return
		}
		date := stamp()
		p["status"], p["updatedAt"] = next, date
		history, _ := p["history"].([]any)
		p["history"] = append(history, object{"status": next, "date": date, "note": note})
		tx, err := a.db.Begin()
		if err != nil {
			a.internal(w, err)
			return
		}
		defer tx.Rollback()
		if _, err = tx.Exec("UPDATE records SET payload=? WHERE id=? AND user_id=? AND kind='requests'", encode(p), id, s.uid); err != nil {
			a.internal(w, err)
			return
		}
		if next == "ready" {
			notification := object{"title": "Демонстрационная заявка готова", "body": fmt.Sprint(p["type"]) + ": демонстрация обработки завершена. Реальный документ не выдаётся.", "category": "requests", "action": "requests", "actionLabel": "Открыть заявку", "requestId": id, "createdAt": date, "read": false}
			if _, err = tx.Exec("INSERT INTO records(user_id,kind,payload) VALUES(?,'notifications',?)", s.uid, encode(notification)); err != nil {
				a.internal(w, err)
				return
			}
		}
		if err = tx.Commit(); err != nil {
			a.internal(w, err)
			return
		}
		respond(w, 200, object{"item": p})
		return
	}
	if kind == "notifications" && len(parts) == 4 && parts[3] == "read" && r.Method == "POST" {
		p["read"] = true
		if e = a.save(s.uid, id, p); e != nil {
			a.internal(w, e)
			return
		}
		respond(w, 200, object{"ok": true})
		return
	}
	fail(w, 404, "Раздел не найден")
}
func (a *app) login(w http.ResponseWriter, r *http.Request) {
	if !a.sameOrigin(r) {
		fail(w, 403, "Вход с другого сайта запрещён")
		return
	}
	var b struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if !readBody(w, r, &b) {
		return
	}
	if len(b.Login) > 100 || len(b.Password) > 256 {
		fail(w, 400, "Проверьте логин и пароль")
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	ip += "|" + strings.ToLower(strings.TrimSpace(b.Login))
	a.mu.Lock()
	recent := []time.Time{}
	cutoff := time.Now().Add(-time.Minute)
	for _, t := range a.attempts[ip] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	if len(recent) >= 10 {
		a.mu.Unlock()
		fail(w, 429, "Слишком много попыток. Подождите минуту.")
		return
	}
	a.attempts[ip] = append(recent, time.Now())
	a.mu.Unlock()
	var uid int
	var salt, stored, raw string
	e := a.db.QueryRow("SELECT id,salt,password_hash,profile FROM users WHERE login=?", strings.ToLower(strings.TrimSpace(b.Login))).Scan(&uid, &salt, &stored, &raw)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		a.internal(w, e)
		return
	}
	if salt == "" {
		salt = strings.Repeat("00", 16)
	}
	candidate := hashPassword(b.Password, salt)
	if e != nil || subtle.ConstantTimeCompare([]byte(candidate), []byte(stored)) != 1 {
		fail(w, 401, "Неверный логин или пароль")
		return
	}
	old, oldErr := a.current(r)
	a.mu.Lock()
	delete(a.attempts, ip)
	a.mu.Unlock()
	tx, e := a.db.Begin()
	if e != nil {
		a.internal(w, e)
		return
	}
	defer tx.Rollback()
	if oldErr == nil {
		if _, e = tx.Exec("DELETE FROM sessions WHERE token_hash=?", old.hash); e != nil {
			a.internal(w, e)
			return
		}
	}
	tok, csrf := token(), token()
	if _, e = tx.Exec("DELETE FROM sessions WHERE expires<=?", time.Now().Unix()); e != nil {
		a.internal(w, e)
		return
	}
	if _, e = tx.Exec("INSERT INTO sessions(token_hash,user_id,csrf,expires) VALUES(?,?,?,?)", digest(tok), uid, csrf, time.Now().Add(8*time.Hour).Unix()); e != nil {
		a.internal(w, e)
		return
	}
	if e = tx.Commit(); e != nil {
		a.internal(w, e)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "session", Value: tok, Path: "/", HttpOnly: true, Secure: a.secureCookie(r), SameSite: http.SameSiteLaxMode, MaxAge: 28800})
	respond(w, 200, object{"user": decode(raw), "csrfToken": csrf})
}
func (a *app) staticFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		fail(w, 405, "Метод не поддерживается")
		return
	}
	for _, part := range strings.Split(r.URL.Path, "/") {
		if part == ".." || strings.HasPrefix(part, ".") {
			fail(w, 404, "Страница не найдена")
			return
		}
	}
	target := filepath.Join(a.static, filepath.FromSlash(strings.TrimPrefix(r.URL.Path, "/")))
	info, e := os.Stat(target)
	if e != nil || info.IsDir() {
		if filepath.Ext(r.URL.Path) != "" {
			fail(w, 404, "Страница не найдена")
			return
		}
		target = filepath.Join(a.static, "index.html")
	}
	real, e := filepath.EvalSymlinks(target)
	if e != nil || !strings.HasPrefix(real, a.static+string(os.PathSeparator)) {
		fail(w, 404, "Интерфейс ещё не собран. Выполните npm run build.")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, real)
}
func subjects(uid int) []string {
	if uid == 1 {
		return []string{"Проектирование интерфейсов", "Базы данных", "Прикладная математика", "Разработка веб-приложений"}
	}
	return []string{"Типографика", "История дизайна", "Цвет и композиция", "Дизайн цифровых продуктов"}
}

var teachers = []string{"Ирина Викторовна Светлова", "Павел Александрович Речной", "Вера Николаевна Облачная", "Артём Дмитриевич Полянов"}

var moscow = time.FixedZone("MSK", 3*3600)

func weekMonday(date time.Time) time.Time {
	date = date.In(moscow)
	date = time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, moscow)
	return date.AddDate(0, 0, -(int(date.Weekday())+6)%7)
}
func scheduleWeek(uid int, date time.Time) []object {
	monday := weekMonday(date)
	out := []object{}
	s := subjects(uid)
	for d := 0; d < 5; d++ {
		for slot, t := range [][2]string{{"09:00", "10:30"}, {"10:45", "12:15"}, {"13:00", "14:30"}} {
			i := (d + slot) % 4
			changed := i == 1 && slot == 1
			room := fmt.Sprintf("А-%d", 201+i)
			if uid == 2 {
				room = fmt.Sprintf("Д-%d", 201+i)
			}
			note := ""
			if changed {
				room = "Б-304"
				if uid == 2 {
					room = "Д-207"
				}
				note = "Аудитория изменена: " + room
			}
			out = append(out, object{"id": fmt.Sprintf("%d-%s-%d", uid, monday.Format("2006-01-02"), d*3+slot), "date": monday.AddDate(0, 0, d).Format("2006-01-02"), "start": t[0], "end": t[1], "subject": s[i], "type": []string{"Лекция", "Практика", "Семинар"}[slot], "room": room, "teacher": teachers[i], "changed": changed, "changeNote": note})
		}
	}
	return out
}
func (a *app) initialize() error {
	_, e := a.db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,login TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,profile TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS record_owner ON records(user_id,kind);`)
	if e != nil {
		return e
	}
	var count int
	if e = a.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); e != nil {
		return e
	}
	if count > 0 {
		return a.migrateDemoContent()
	}
	for uid := 1; uid <= 2; uid++ {
		login, name, group, program, faculty, year := "alina", "Алина Сергеевна Ветрова", "ИС-23-1", "Информационные системы и технологии", "Цифровых технологий", 3
		if uid == 2 {
			login, name, group, program, faculty, year = "mark", "Марк Андреевич Леснов", "ДЗ-24-2", "Дизайн цифровой среды", "Дизайна и коммуникаций", 2
		}
		salt := token()
		profile := object{"id": uid, "name": name, "faculty": faculty, "program": program, "year": year, "group": group, "email": login + "@student.example", "studentNumber": fmt.Sprintf("ДЕМО-2026-00%d", uid)}
		if _, e = a.db.Exec("INSERT INTO users(id,login,salt,password_hash,profile) VALUES(?,?,?,?,?)", uid, login, salt, hashPassword("Campus2026!", salt), encode(profile)); e != nil {
			return e
		}
		s := subjects(uid)
		for i, subject := range s {
			score := []int{88, 74, 56, 92}[i]
			if uid == 2 {
				score = []int{95, 81, 77, 89}[i]
			}
			status := "in_progress"
			if uid == 1 && i == 2 {
				status = "attention"
			} else if i == 3 {
				status = "passed"
			}
			assessment := "Экзамен"
			if i%2 == 1 {
				assessment = "Зачёт"
			}
			if _, e = a.insert(uid, "grades", object{"subject": subject, "teacher": teachers[i], "score": score, "maxScore": 100, "status": status, "examDate": time.Now().AddDate(0, 0, 25+i*3).Format("2006-01-02"), "assessment": assessment}); e != nil {
				return e
			}
		}
		date := stamp()
		if _, e = a.insert(uid, "requests", object{"type": "Справка об обучении", "comment": "Демонстрационная заявка", "status": "ready", "createdAt": date, "updatedAt": date, "history": []object{{"status": "submitted", "date": date, "note": "Демонстрационная заявка создана"}, {"status": "processing", "date": date, "note": "Пример рассмотрения обращения"}, {"status": "ready", "date": date, "note": "Демонстрационный статус: справка готова. Реальный документ не выдаётся."}}}); e != nil {
			return e
		}
		room := "Б-304"
		if uid == 2 {
			room = "Д-207"
		}
		for _, n := range []object{
			{"title": "Изменение в расписании", "body": "Занятие «" + s[1] + "» перенесено в аудиторию " + room + ". Проверьте расписание перед парой.", "category": "schedule", "action": "schedule"},
			{"title": "Справка готова", "body": "Демонстрационная справка об обучении готова. Статус доступен в разделе заявок.", "category": "requests", "action": "requests"},
			{"title": "План на сессию", "body": "Посмотрите текущие баллы и даты аттестаций: до сессии ещё есть время закрыть все задания.", "category": "deadline", "action": "grades"},
		} {
			n["createdAt"] = date
			n["read"] = false
			if _, e = a.insert(uid, "notifications", n); e != nil {
				return e
			}
		}
	}
	return a.migrateDemoContent()
}

// Add content once to existing demo databases without replacing user records or read flags.
func (a *app) migrateDemoContent() error {
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY)"); err != nil {
		return err
	}
	// Upgrade only known demo names; preserve all other profile and record fields.
	for _, person := range [][2]string{
		{"Алина Ветрова", "Алина Сергеевна Ветрова"},
		{"Марк Леснов", "Марк Андреевич Леснов"},
		{"Ирина Светлова", "Ирина Викторовна Светлова"},
		{"Павел Речной", "Павел Александрович Речной"},
		{"Вера Облачная", "Вера Николаевна Облачная"},
		{"Артём Полянов", "Артём Дмитриевич Полянов"},
	} {
		if _, err = tx.Exec(`UPDATE users SET profile=json_set(profile,'$.name',?) WHERE json_extract(profile,'$.name')=?`, person[1], person[0]); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE records SET payload=json_set(payload,'$.teacher',?) WHERE kind='grades' AND json_extract(payload,'$.teacher')=?`, person[1], person[0]); err != nil {
			return err
		}
	}
	var count int
	if err = tx.QueryRow("SELECT COUNT(*) FROM migrations WHERE name='demo-news-deadlines-v1'").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return tx.Commit()
	}
	now := time.Now().In(moscow)
	due := now.AddDate(0, 0, 7).Format("2006-01-02")
	for uid := 1; uid <= 2; uid++ {
		for _, n := range []object{
			{"title": "Приём заявлений на материальную помощь", "body": "Подайте демонстрационное заявление до " + due + ". В форме укажите основание обращения; реальные документы и персональные сведения не прикладывайте.", "category": "deadline", "dueDate": due, "action": "requests", "actionLabel": "Подать заявление", "requestType": "Заявление на материальную помощь"},
			{"title": "Объявление деканата о справках", "body": "В учебном прототипе справку об обучении можно заказать онлайн. Откройте форму, отправьте заявку и пройдите два демонстрационных этапа обработки. Реальные справки не выдаются.", "category": "news", "action": "requests", "actionLabel": "Заказать справку", "requestType": "Справка об обучении"},
		} {
			n["createdAt"], n["read"] = stamp(), false
			if _, err = tx.Exec("INSERT INTO records(user_id,kind,payload) VALUES(?,'notifications',?)", uid, encode(n)); err != nil {
				return err
			}
		}
	}
	if _, err = tx.Exec("INSERT INTO migrations(name) VALUES('demo-news-deadlines-v1')"); err != nil {
		return err
	}
	return tx.Commit()
}

func validatePublicOrigin(raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("public-origin должен быть HTTPS origin без пути, параметров или логина")
	}
	return "https://" + u.Host, nil
}
func main() {
	host := flag.String("host", "127.0.0.1", "Адрес локального сервера")
	port := flag.Int("port", 8000, "Порт")
	dbPath := flag.String("db", "data/razumist.sqlite3", "Путь к SQLite")
	static := flag.String("static", "dist", "Каталог собранного React-интерфейса")
	publicOrigin := flag.String("public-origin", "", "Явный HTTPS origin для доверенного обратного прокси; пусто для локального HTTP")
	flag.Parse()
	origin, err := validatePublicOrigin(*publicOrigin)
	if err != nil {
		log.Fatal(err)
	}
	if e := os.MkdirAll(filepath.Dir(*dbPath), 0700); e != nil {
		log.Fatal(e)
	}
	db, e := sql.Open("sqlite", *dbPath+"?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if e != nil {
		log.Fatal(e)
	}
	defer db.Close()
	db.SetMaxOpenConns(4)
	abs, e := filepath.Abs(*static)
	if e != nil {
		log.Fatal(e)
	}
	if resolved, e := filepath.EvalSymlinks(abs); e == nil {
		abs = resolved
	}
	bindIP := net.ParseIP(*host)
	a := &app{publicOrigin: origin, db: db, static: abs, attempts: map[string][]time.Time{}, loopbackOnly: *host == "localhost" || (bindIP != nil && bindIP.IsLoopback())}
	if e = a.initialize(); e != nil {
		log.Fatal(e)
	}
	if e = os.Chmod(*dbPath, 0600); e != nil {
		log.Fatal(e)
	}
	address := net.JoinHostPort(*host, strconv.Itoa(*port))
	server := http.Server{Addr: address, Handler: a, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	log.Printf("Разумист — локальный конкурсный прототип: http://%s", address)
	log.Fatal(server.ListenAndServe())
}
