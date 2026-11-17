"""Интеграционные проверки реального HTTP API с изолированной SQLite БД."""
import http.cookiejar
import json
import os
import shutil
from pathlib import Path
import socket
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
    def start_server(cls):
        cls.process = subprocess.Popen([cls.binary, '--host', '127.0.0.1', '--port', str(cls.port), '--db', str(cls.db)], cwd=str(ROOT), stdout=cls.log, stderr=cls.log)
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
