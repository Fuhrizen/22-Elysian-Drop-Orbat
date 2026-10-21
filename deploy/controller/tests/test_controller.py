import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('controller', Path(__file__).resolve().parents[1] / 'reconcile.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class SelectionTests(unittest.TestCase):
    def test_only_active_same_repository_allowlisted_prs(self):
        pr = {'state': 'open', 'draft': False, 'base': {'ref': 'main'},
              'head': {'repo': {'full_name': 'a/b'}}, 'user': {'login': 'Owner'}}
        self.assertTrue(c.eligible(pr, 'a/b', {'owner'}))
        for changes in ({'draft': True}, {'state': 'closed'}, {'base': {'ref': 'other'}},
                        {'head': {'repo': {'full_name': 'fork/b'}}}, {'head': {'repo': None}},
                        {'user': {'login': 'stranger'}}):
            self.assertFalse(c.eligible({**pr, **changes}, 'a/b', {'owner'}))

    def test_successful_ci_must_match_revision_branch_event_and_repository(self):
        run = {'head_sha': 'a' * 40, 'head_branch': 'main', 'event': 'push',
               'conclusion': 'success', 'head_repository': {'full_name': 'a/b'}}
        wrong = [{**run, 'head_sha': 'b' * 40}, {**run, 'head_branch': 'other'},
                 {**run, 'event': 'pull_request'}, {**run, 'conclusion': 'failure'},
                 {**run, 'head_repository': {'full_name': 'fork/b'}}]
        with patch.object(c, 'api', return_value={'workflow_runs': wrong + [run]}):
            self.assertEqual(c.successful_run('a/b', 'a' * 40, 'main', 'push'), run)

    def test_api_failure_does_not_return_partial_pr_inventory(self):
        with patch.object(c, 'api', side_effect=[[{}] * 100, OSError('offline')]):
            with self.assertRaises(OSError):
                c.pages('a/b', 'pulls?state=open')

    def test_unsafe_origin_or_public_bind_is_rejected(self):
        for origin, bind in [('https://example.com/path', '127.0.0.1'),
                             ('https://example.com\nanything', '127.0.0.1'),
                             ('https://example.com', '0.0.0.0'),
                             ('https://example.com', '8.8.8.8')]:
            with self.assertRaises(ValueError):
                c.configuration(Path('/tmp/test'), 'test', 'image', 'revision', origin, bind, 3000)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.target = Path(self.temp.name) / 'production'
        self.target.mkdir()
        (self.target / 'data').mkdir()
        self.db = self.target / 'data/regiment.sqlite'
        self.db.write_text('before migration')
        self.old = c.configuration(self.target, 'orbat-production', 'old@digest', 'a'*40,
                                   'https://example.com', '127.0.0.1', 3000, True)
        self.new = c.configuration(self.target, 'orbat-production', 'new@digest', 'b'*40,
                                   'https://example.com', '127.0.0.1', 3000, True)
        c.atomic(self.target / 'current.json', self.old)
        self.calls = []
        self.fail_backup = False
        self.fail_smoke = False
        self.fail_start = False
        self.patches = [patch.object(c, 'utility', self.utility),
                        patch.object(c, 'compose', self.compose), patch.object(c, 'smoke', self.smoke)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.temp.cleanup()

    def utility(self, target, *args):
        if 'existsSync' in args[-1]:
            return str(self.db.exists()).lower()
        if args[0] == '/snapshot.mjs':
            mode, path = args[1:]
            snapshot = self.target / path.removeprefix('/target/')
            self.calls.append(mode)
            if mode == 'backup':
                if self.fail_backup:
                    raise RuntimeError('backup failed')
                shutil.copyfile(self.db, snapshot)
            elif mode == 'restore':
                shutil.copyfile(snapshot, self.db)
        elif "['regiment.sqlite'" in args[-1]:
            self.db.unlink(missing_ok=True)
        return ''

    def compose(self, config, *args):
        self.calls.append((config['revision'], args[0]))
        if args[0] == 'up' and config == self.new:
            self.db.write_text('candidate migration')
            if self.fail_start:
                raise RuntimeError('unhealthy candidate')
        return ''

    def smoke(self, config):
        self.calls.append('smoke')
        if self.fail_smoke:
            raise RuntimeError('smoke failure')

    def test_success_backs_up_before_migration_and_records_matching_image(self):
        c.deploy(self.target, self.new, 'synthetic-key')
        self.assertLess(self.calls.index('backup'), self.calls.index((self.new['revision'], 'up')))
        self.assertEqual(json.loads((self.target/'current.json').read_text()), self.new)
        self.assertFalse((self.target/'transaction.json').exists())
        metadata = json.loads(next((self.target/'backups').glob('*.json')).read_text())
        self.assertEqual(metadata['previous'], self.old)
        self.assertEqual(self.db.read_text(), 'candidate migration')

    def test_failed_migration_restores_database_and_last_good_image(self):
        self.fail_start = True
        with self.assertRaisesRegex(RuntimeError, 'unhealthy'):
            c.deploy(self.target, self.new, 'synthetic-key')
        self.assertEqual(self.db.read_text(), 'before migration')
        self.assertEqual(self.calls[-1], (self.old['revision'], 'up'))
        self.assertEqual(json.loads((self.target/'current.json').read_text()), self.old)

    def test_smoke_failure_restores_database(self):
        self.fail_smoke = True
        with self.assertRaisesRegex(RuntimeError, 'smoke'):
            c.deploy(self.target, self.new, 'synthetic-key')
        self.assertEqual(self.db.read_text(), 'before migration')

    def test_backup_failure_resumes_old_without_starting_candidate(self):
        self.fail_backup = True
        with self.assertRaisesRegex(RuntimeError, 'backup'):
            c.deploy(self.target, self.new, 'synthetic-key')
        self.assertNotIn((self.new['revision'], 'up'), self.calls)
        self.assertEqual(self.calls[-1], (self.old['revision'], 'up'))

    def test_interrupted_candidate_is_recovered_on_next_run(self):
        (self.target/'backups').mkdir()
        snapshot = self.target/'backups/recovery.sqlite'
        snapshot.write_text('before migration')
        self.db.write_text('interrupted migration')
        c.atomic(self.target/'transaction.json', {'candidate': self.new, 'previous': self.old,
                 'snapshot': 'backups/recovery.sqlite', 'had_database': True, 'phase': 'candidate'})
        c.recover(self.target)
        self.assertEqual(self.db.read_text(), 'before migration')
        self.assertEqual(self.calls[-1], (self.old['revision'], 'up'))

    def test_interruption_after_commit_does_not_roll_back_success(self):
        c.atomic(self.target/'current.json', self.new)
        c.atomic(self.target/'transaction.json', {'candidate': self.new})
        c.recover(self.target)
        self.assertEqual(self.calls, [])
        self.assertFalse((self.target/'transaction.json').exists())


if __name__ == '__main__':
    unittest.main()
