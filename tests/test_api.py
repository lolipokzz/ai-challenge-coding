"""Интеграционные проверки реального HTTP API с изолированной SQLite БД."""
import datetime
import http.cookiejar
import json
import os
import shutil
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


class Client:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.token = None

    def call(self, path, method='GET', data=None, csrf=True, origin=None, raw=None):
        headers = {'Origin': origin or self.base}
        if csrf and self.token:
            headers['X-CSRF-Token'] = self.token
        body = raw
        if data is not None:
            body = json.dumps(data).encode()
        if body is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=headers)
        try:
            response = self.opener.open(req, timeout=5)
        except urllib.error.HTTPError as exc:
            response = exc
        content = response.read()
        try:
            payload = json.loads(content)
        except (ValueError, UnicodeError):
            payload = content.decode(errors='replace')
        result = response.status, payload, response.headers
        response.close()
        return result

    def login(self, login='alina'):
        status, body, headers = self.call('/api/login', 'POST', {'login': login, 'password': 'Campus2026!'})
        if status != 200:
            raise AssertionError('Login failed: %r %r' % (status, body))
        self.token = body['csrfToken']
        return body, headers


class APITest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='razumist-test-')
        cls.db = Path(cls.temp.name) / 'test.sqlite3'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.base = 'http://127.0.0.1:%s' % cls.port
        cls.log = open(Path(cls.temp.name) / 'server.log', 'w+')
        cls.binary = os.environ.get('RAZUMIST_SERVER_BIN')
        if not cls.binary:
            go = shutil.which('go')
            if not go:
                raise RuntimeError('Нужен go в PATH или RAZUMIST_SERVER_BIN с путём готового бинарника')
            cls.binary = str(Path(cls.temp.name) / 'razumist-server')
            subprocess.run([go, 'build', '-o', cls.binary, '.'], cwd=str(ROOT), check=True)
        cls.start_server()

    @classmethod
    def start_server(cls, extra_args=None):
        cls.process = subprocess.Popen([cls.binary, '--host', '127.0.0.1', '--port', str(cls.port), '--db', str(cls.db)] + (extra_args or []), cwd=str(ROOT), stdout=cls.log, stderr=cls.log)
        for _ in range(100):
            if cls.process.poll() is not None:
                cls.log.seek(0)
                raise RuntimeError(cls.log.read())
            try:
                Client(cls.base).call('/api/me')
                return
            except (OSError, urllib.error.URLError):
                time.sleep(.05)
        raise RuntimeError('Сервер не запустился за 5 секунд')

    @classmethod
    def stop_server(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)

    @classmethod
    def tearDownClass(cls):
        cls.stop_server()
        cls.log.close()
        cls.temp.cleanup()

    def setUp(self):
        # Новый процесс изолирует счётчики rate limit; SQLite сохраняется.
        self.stop_server()
        self.start_server()
        self.alina = Client(self.base)
        self.mark = Client(self.base)
        self.alina.login()
        self.mark.login('mark')

    def create_request(self, client=None, **extra):
        data = {'type': 'Справка об обучении', 'comment': 'Проверка сохранения заявки'}
        data.update(extra)
        status, payload, _ = (client or self.alina).call('/api/requests', 'POST', data)
        self.assertEqual(status, 201, payload)
        return payload['item']

    def test_anonymous_and_wrong_password(self):
        client = Client(self.base)
        for path in ['/api/me', '/api/dashboard', '/api/grades', '/api/schedule', '/api/requests', '/api/notifications']:
            with self.subTest(path=path):
                self.assertEqual(client.call(path)[0], 401)
        status, body, _ = client.call('/api/login', 'POST', {'login': 'alina', 'password': 'wrong'})
        self.assertEqual(status, 401)
        self.assertIn('error', body)

    def test_profiles_and_cookie(self):
        a, headers = self.alina.login()
        b, _ = self.mark.login('mark')
        for field in ['id', 'name', 'faculty', 'program', 'year', 'group', 'email', 'studentNumber']:
            self.assertIn(field, a['user'])
        self.assertNotEqual(a['user']['id'], b['user']['id'])
        self.assertNotEqual(a['user']['name'], b['user']['name'])
        cookie = headers.get('Set-Cookie', '').lower()
        self.assertIn('httponly', cookie)
        self.assertIn('samesite=', cookie)
        self.assertNotIn('password', json.dumps(a['user']).lower())

    def test_dashboard_and_separate_academic_data(self):
        for client in [self.alina, self.mark]:
            status, body, _ = client.call('/api/dashboard')
            self.assertEqual(status, 200)
            for key in ['schedule', 'grades', 'requests', 'notifications']:
                self.assertIsInstance(body[key], list)
        self.assertNotEqual(self.alina.call('/api/grades')[1], self.mark.call('/api/grades')[1])
        self.assertNotEqual(self.alina.call('/api/schedule')[1], self.mark.call('/api/schedule')[1])

    def test_request_ownership_get_and_cancel(self):
        item = self.create_request()
        path = '/api/requests/' + str(item['id'])
        self.assertEqual(self.mark.call(path)[0], 404)
        self.assertEqual(self.mark.call(path + '/cancel', 'POST', {})[0], 404)
        self.assertNotIn(item['id'], [x['id'] for x in self.mark.call('/api/requests')[1]['items']])
        status, body, _ = self.alina.call(path + '/cancel', 'POST', {})
        self.assertEqual(status, 200, body)
        self.assertEqual(body['item']['status'], 'cancelled')
        self.assertGreaterEqual(len(body['item']['history']), 2)

    def test_client_cannot_assign_owner(self):
        mark_id = self.mark.call('/api/me')[1]['user']['id']
        data = {'type': 'Справка об обучении', 'comment': '', 'student_id': mark_id, 'user_id': mark_id}
        status, body, _ = self.alina.call('/api/requests', 'POST', data)
        self.assertIn(status, [201, 400], body)
        if status == 201:
            item_id = body['item']['id']
            self.assertEqual(self.mark.call('/api/requests/' + str(item_id))[0], 404)
            self.assertEqual(self.alina.call('/api/requests/' + str(item_id))[0], 200)

    def test_csrf_and_cross_origin_rejected(self):
        data = {'type': 'Справка об обучении', 'comment': 'CSRF'}
        self.assertEqual(self.alina.call('/api/requests', 'POST', data, csrf=False)[0], 403)
        self.assertEqual(self.alina.call('/api/requests', 'POST', data, origin='https://attacker.example')[0], 403)
        self.assertEqual(self.alina.call('/api/logout', 'POST', {}, csrf=False)[0], 403)

    def test_invalid_request_and_malformed_json(self):
        for data in [{'type': 'Неизвестная справка', 'comment': ''}, {'type': 'Справка об обучении', 'comment': 'x' * 20000}]:
            status, body, _ = self.alina.call('/api/requests', 'POST', data)
            self.assertIn(status, [400, 413, 422], body)
            self.assertIn('error', body)
        status, body, _ = self.alina.call('/api/requests', 'POST', raw=b'{bad json')
        self.assertEqual(status, 400, body)

    def test_notification_ownership_and_read(self):
        items = self.alina.call('/api/notifications')[1]['items']
        self.assertTrue(items)
        item = items[0]
        path = '/api/notifications/%s/read' % item['id']
        self.assertEqual(self.mark.call(path, 'POST', {})[0], 404)
        self.assertEqual(self.alina.call(path, 'POST', {})[0], 200)
        saved = next(x for x in self.alina.call('/api/notifications')[1]['items'] if x['id'] == item['id'])
        self.assertTrue(saved['read'])

    def test_logout_invalidates_session(self):
        stolen_cookies = '; '.join('%s=%s' % (c.name, c.value) for c in self.alina.jar)
        self.assertEqual(self.alina.call('/api/logout', 'POST', {})[0], 200)
        self.assertEqual(self.alina.call('/api/me')[0], 401)
        req = urllib.request.Request(self.base + '/api/me', headers={'Cookie': stolen_cookies})
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(raised.exception.code, 401)
        raised.exception.close()

    def test_login_rotates_session(self):
        old_cookie = '; '.join('%s=%s' % (c.name, c.value) for c in self.alina.jar)
        self.alina.login()
        self.assertEqual(self.alina.call('/api/me')[0], 200)
        req = urllib.request.Request(self.base + '/api/me', headers={'Cookie': old_cookie})
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(raised.exception.code, 401)
        raised.exception.close()

    def test_login_rate_limit(self):
        client = Client(self.base)
        statuses = [client.call('/api/login', 'POST', {'login': 'missing', 'password': 'wrong'})[0] for _ in range(12)]
        self.assertEqual(statuses[:10], [401] * 10)
        self.assertEqual(statuses[10:], [429, 429])
        self.assertNotIn(200, statuses)

    def test_schedule_week_validation_and_normalization(self):
        weeks = []
        for requested, monday in [('2026-11-18', '2026-11-16'), ('2026-11-29', '2026-11-23')]:
            status, body, _ = self.alina.call('/api/schedule?week=' + requested)
            self.assertEqual(status, 200, body)
            self.assertEqual(body['weekStart'], monday)
            self.assertEqual(body['timeZone'], 'Europe/Moscow')
            self.assertEqual(len(body['items']), 15)
            self.assertEqual(min(x['date'] for x in body['items']), monday)
            weeks.append(body['items'])
        self.assertFalse(set(x['id'] for x in weeks[0]) & set(x['id'] for x in weeks[1]))
        for invalid in ['2026-02-30', 'tomorrow', '1999-01-01', '2101-01-01']:
            self.assertEqual(self.alina.call('/api/schedule?week=' + invalid)[0], 400)
        dashboard = self.alina.call('/api/dashboard')[1]
        self.assertEqual(len(dashboard['schedule']), 30)
        dates = sorted(set(x['date'] for x in dashboard['schedule']))
        self.assertEqual((datetime.date.fromisoformat(dates[-1]) - datetime.date.fromisoformat(dates[0])).days, 11)

    def test_group_schedule_selection_and_validation(self):
        query = '/api/schedule?week=2026-11-18'
        mine = self.mark.call(query)[1]
        other = self.alina.call(query + '&group=' + urllib.parse.quote('ДЗ-24-2'))[1]
        self.assertEqual(mine, other)
        self.assertEqual(other['groupId'], 'ДЗ-24-2')
        self.assertEqual(set(other['groups']), {'ИС-23-1', 'ДЗ-24-2'})
        self.assertTrue(all(x['group'] == 'ДЗ-24-2' for x in other['items']))
        self.assertEqual(self.alina.call(query + '&group=unknown')[0], 404)
        self.assertEqual(self.alina.call(query + '&group=unknown&teacher=teacher-1')[0], 400)
        self.assertEqual(Client(self.base).call(query + '&group=' + urllib.parse.quote('ИС-23-1'))[0], 401)

    def test_teacher_schedule_matches_groups_without_conflicts(self):
        query = '/api/schedule?week=2026-11-18'
        first = self.alina.call(query)[1]
        second = self.mark.call(query)[1]
        self.assertEqual(len(first['teachers']), 4)
        self.assertEqual(first['teacherId'], '')
        for teacher in first['teachers']:
            status, data, _ = self.alina.call(query + '&teacher=' + teacher['id'])
            self.assertEqual(status, 200)
            expected = [x for x in first['items'] + second['items'] if x['teacherId'] == teacher['id']]
            self.assertEqual(data['items'], expected)
            self.assertEqual(data['weekStart'], '2026-11-16')
            self.assertEqual({x['group'] for x in data['items']}, {'ИС-23-1', 'ДЗ-24-2'})
            self.assertTrue(all(x['teacherPosition'] == teacher['position'] for x in data['items']))
            self.assertEqual(data, self.mark.call(query + '&teacher=' + teacher['id'])[1])
            self.assertFalse(any('profile' in x or 'email' in x or 'score' in x for x in data['items']))
            ordered = sorted(data['items'], key=lambda x: (x['date'], x['start']))
            for a, b in zip(ordered, ordered[1:]):
                if a['date'] == b['date']:
                    self.assertLessEqual(a['end'], b['start'])
        self.assertEqual(Client(self.base).call(query + '&teacher=teacher-1')[0], 401)
        self.assertEqual(self.alina.call(query + '&teacher=unknown')[0], 404)
        self.assertEqual(self.alina.call('/api/schedule?week=invalid&teacher=teacher-1')[0], 400)

    def test_demo_request_lifecycle_and_notification(self):
        item = self.create_request()
        path = '/api/requests/%s/demo-advance' % item['id']
        self.assertEqual(self.mark.call(path, 'POST', {})[0], 404)
        self.assertEqual(self.alina.call(path, 'POST', {}, csrf=False)[0], 403)
        for expected in ['processing', 'ready']:
            status, body, _ = self.alina.call(path, 'POST', {})
            self.assertEqual(status, 200, body)
            self.assertEqual(body['item']['status'], expected)
        self.assertEqual([h['status'] for h in body['item']['history']], ['submitted', 'processing', 'ready'])
        self.assertEqual(self.alina.call(path, 'POST', {})[0], 409)
        self.assertEqual(self.alina.call('/api/requests/%s/cancel' % item['id'], 'POST', {})[0], 409)
        mine = self.alina.call('/api/notifications')[1]['items']
        self.assertEqual(len([n for n in mine if n.get('requestId') == item['id']]), 1)
        theirs = self.mark.call('/api/notifications')[1]['items']
        self.assertFalse(any(n.get('requestId') == item['id'] for n in theirs))
        cancelled = self.create_request()
        self.alina.call('/api/requests/%s/cancel' % cancelled['id'], 'POST', {})
        self.assertEqual(self.alina.call('/api/requests/%s/demo-advance' % cancelled['id'], 'POST', {})[0], 409)
        self.stop_server()
        self.start_server()
        self.alina.login()
        saved = self.alina.call('/api/requests/%s' % item['id'])[1]['item']
        self.assertEqual(saved['status'], 'ready')
        self.assertEqual(len(saved['history']), 3)

    def test_patronymic_migration_preserves_existing_data(self):
        item = self.create_request()
        self.stop_server()
        with sqlite3.connect(self.db) as db:
            db.execute("UPDATE users SET profile=json_set(profile,'$.name','Алина Ветрова') WHERE login='alina'")
            db.execute("UPDATE users SET profile=json_set(profile,'$.name','Марк Леснов') WHERE login='mark'")
            db.execute("UPDATE records SET payload=json_set(payload,'$.teacher','Ирина Светлова') WHERE kind='grades'")
            before = db.execute("SELECT id,user_id,kind,payload FROM records WHERE kind!='grades' ORDER BY id").fetchall()
        for _ in range(2):
            self.start_server()
            self.alina.login()
            self.mark.login('mark')
            self.assertEqual(self.alina.call('/api/me')[1]['user']['name'], 'Алина Сергеевна Ветрова')
            self.assertEqual(self.mark.call('/api/me')[1]['user']['name'], 'Марк Андреевич Леснов')
            grades = self.alina.call('/api/grades')[1]['items']
            self.assertTrue(all(g['teacher'] == 'Ирина Викторовна Светлова' for g in grades))
            self.assertEqual(self.alina.call('/api/requests/%s' % item['id'])[0], 200)
            self.assertEqual(self.mark.call('/api/requests/%s' % item['id'])[0], 404)
            self.stop_server()
            with sqlite3.connect(self.db) as db:
                self.assertEqual(before, db.execute("SELECT id,user_id,kind,payload FROM records WHERE kind!='grades' ORDER BY id").fetchall())
        self.start_server()

    def test_news_deadline_migration_preserves_read_state(self):
        items = self.alina.call('/api/notifications')[1]['items']
        deadline = next(n for n in items if n.get('dueDate'))
        datetime.date.fromisoformat(deadline['dueDate'])
        self.assertEqual(deadline['requestType'], 'Заявление на материальную помощь')
        self.assertTrue(any(n['category'] == 'news' for n in items))
        self.alina.call('/api/notifications/%s/read' % deadline['id'], 'POST', {})
        self.stop_server()
        self.start_server()
        self.alina.login()
        saved = self.alina.call('/api/notifications')[1]['items']
        self.assertEqual(len(saved), len(items))
        self.assertTrue(next(n for n in saved if n['id'] == deadline['id'])['read'])

    def test_public_origin_secure_cookie_and_csrf(self):
        self.stop_server()
        self.start_server(['--public-origin', 'https://razumist.example'])
        client = Client(self.base)
        try:
            credentials = {'login': 'alina', 'password': 'Campus2026!'}
            self.assertEqual(client.call('/api/login', 'POST', credentials)[0], 403)
            self.assertEqual(client.call('/api/login', 'POST', credentials, origin='https://attacker.example')[0], 403)
            status, body, headers = client.call('/api/login', 'POST', credentials, origin='https://razumist.example')
            self.assertEqual(status, 200, body)
            self.assertIn('secure', headers.get('Set-Cookie', '').lower())
            # Simulate the trusted TLS terminator forwarding an authenticated request.
            cookie = headers['Set-Cookie'].split(';')[0]
            for origin, expected in [('https://attacker.example', 403), ('https://razumist.example', 200)]:
                req = urllib.request.Request(self.base + '/api/logout', data=b'{}', method='POST', headers={
                    'Origin': origin, 'Content-Type': 'application/json', 'Cookie': cookie,
                    'X-CSRF-Token': body['csrfToken'], 'X-Forwarded-Proto': 'http'})
                try:
                    response = urllib.request.urlopen(req, timeout=5)
                except urllib.error.HTTPError as exc:
                    response = exc
                self.assertEqual(response.status, expected)
                if expected == 200:
                    self.assertIn('secure', response.headers.get('Set-Cookie', '').lower())
                response.close()
        finally:
            self.stop_server()
            self.start_server()

    def test_z_persistence_after_restart(self):
        item = self.create_request()
        self.stop_server()
        self.start_server()
        client = Client(self.base)
        client.login()
        status, payload, _ = client.call('/api/requests/' + str(item['id']))
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload['item']['comment'], item['comment'])
        self.assertEqual(payload['item']['status'], item['status'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
