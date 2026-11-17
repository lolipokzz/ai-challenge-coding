"""Validate activation and rollback control flow without touching real services."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform.startswith('linux'), 'Activation uses Linux mv -T')
class DeploymentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.base = self.root / 'app'
        self.old, self.new = 'a' * 40, 'b' * 40
        for revision in (self.old, self.new):
            release = self.base / 'releases' / revision
            release.mkdir(parents=True)
            binary = release / 'razumist'
            binary.write_text('#!/bin/sh\nexit 0\n')
            binary.chmod(0o755)
        (self.base / 'current').symlink_to(self.base / 'releases' / self.old)
        mocks = self.root / 'bin'
        mocks.mkdir()
        self.log = self.root / 'service.log'
        self.backup = self.root / 'backup.marker'
        commands = {
            'systemctl': '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SERVICE_LOG"\n',
            'sleep': '#!/bin/sh\nexit 0\n',
            'curl': '''#!/bin/bash
if [[ "$SIMULATE_SUCCESS" != 1 ]]; then exit 1; fi
case "${@: -1}" in
  */version.txt) printf '%s' "$TEST_REVISION" ;;
  */api/me) printf '401' ;;
  *) exit 1 ;;
esac
''',
        }
        for name, content in commands.items():
            p = mocks / name
            p.write_text(content)
            p.chmod(0o755)
        source = (Path(__file__).resolve().parents[1] / 'deploy/razumist-activate').read_text()
        source = source.replace('base=/srv/razumist', 'base=' + str(self.base))
        source = source.replace('/usr/local/sbin/razumist-backup', 'touch "$BACKUP_MARKER"')
        self.script = self.root / 'activate'
        self.script.write_text(source)
        self.env = dict(os.environ, PATH=str(mocks) + ':' + os.environ['PATH'],
                        SERVICE_LOG=str(self.log), BACKUP_MARKER=str(self.backup),
                        TEST_REVISION=self.new, SIMULATE_SUCCESS='1')

    def run_activation(self, revision):
        return subprocess.run(['bash', str(self.script), revision], env=self.env,
                              capture_output=True, text=True, timeout=10)

    def test_healthy_release_is_activated_after_backup(self):
        result = self.run_activation(self.new)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.base / 'current').resolve().name, self.new)
        self.assertTrue(self.backup.exists())
        self.assertEqual(self.log.read_text().splitlines(), ['restart razumist.service'])

    def test_unhealthy_release_restores_previous_symlink_and_restarts(self):
        self.env['SIMULATE_SUCCESS'] = '0'
        result = self.run_activation(self.new)
        self.assertEqual(result.returncode, 1)
        self.assertEqual((self.base / 'current').resolve().name, self.old)
        self.assertTrue(self.backup.exists())
        self.assertEqual(self.log.read_text().splitlines(),
                         ['restart razumist.service', 'restart razumist.service'])

    def test_invalid_revision_cannot_change_active_release(self):
        result = self.run_activation('../invalid')
        self.assertEqual(result.returncode, 2)
        self.assertEqual((self.base / 'current').resolve().name, self.old)
        self.assertFalse(self.log.exists())
        self.assertFalse(self.backup.exists())
