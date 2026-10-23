import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('controller', Path(__file__).parents[1] / 'reconcile.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def pr(number=12, author='Fuhrizen', repository=None, draft=False):
    return {'number': number, 'state': 'open', 'draft': draft, 'user': {'login': author},
            'base': {'ref': 'main'}, 'head': {'ref': 'feature', 'sha': 'a'*40,
            'repo': {'full_name': repository or c.REPOSITORY}}}


class Selection(unittest.TestCase):
    def test_only_approved_same_repository_open_prs(self):
        self.assertTrue(c.eligible(pr()))
        self.assertFalse(c.eligible(pr(author='unknown')))
        self.assertFalse(c.eligible(pr(repository='outsider/fork')))
        self.assertFalse(c.eligible(pr(draft=True)))
        closed = pr(); closed['state'] = 'closed'
        self.assertFalse(c.eligible(closed))

    def test_target_identity_survives_branch_rename(self):
        item = pr(); first = c.target_name(item)
        item['head']['ref'] = 'renamed-branch'
        self.assertEqual(first, c.target_name(item))
        item['number'] = '../../production'
        with self.assertRaises(ValueError): c.target_name(item)

    def test_exact_revision_and_repository_build_selection(self):
        run = {'head_sha': 'a'*40, 'head_branch': 'feature', 'event': 'pull_request',
               'conclusion': 'success', 'head_repository': {'full_name': c.REPOSITORY}}
        wrong = {**run, 'head_sha': 'b'*40}
        with patch.object(c, 'api', return_value={'workflow_runs': [wrong, run]}):
            self.assertEqual(c.successful_run('a'*40, 'feature', 'pull_request'), run)
            self.assertIsNone(c.successful_run('b'*40, 'main', 'push'))

    def test_incomplete_inventory_fails_before_cleanup(self):
        with patch.object(c, 'api', return_value=[pr()]*100):
            with self.assertRaisesRegex(RuntimeError, 'incomplete'): c.inventory()


class Persistence(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.target = self.root / 'previews/pr-12'
        self.target.mkdir(parents=True)
        (self.target/'data').mkdir()
        self.db = self.target/'data/regiment.sqlite'
        with sqlite3.connect(self.db) as db:
            db.execute('create table records (name text)')
            db.execute("insert into records values ('existing member')")
        self.old = c.config(self.target, 'a'*40, 'image@sha256:old', '127.0.0.1', 32001)
        self.new = c.config(self.target, 'b'*40, 'image@sha256:new', '127.0.0.1', 32001)
        c.atomic(self.target/'current.json', self.old)

    def tearDown(self): self.tmp.cleanup()

    def utility(self, target, *args):
        if args[0] == '/snapshot.mjs':
            path = target / args[2].removeprefix('/target/')
            if args[1] == 'backup':
                with sqlite3.connect(self.db) as source, sqlite3.connect(path) as dest:
                    source.backup(dest)
            elif args[1] == 'restore': shutil.copyfile(path, self.db)
        elif '.deployment-paused' in args[-1]:
            guard = target/'data/.deployment-paused'
            if 'writeFileSync' in args[-1]: guard.touch()
            else: guard.unlink(missing_ok=True)
        elif 'console.log' in args[-1]: return 'true' if self.db.exists() else 'false'
        elif "for(const s of" in args[-1]: self.db.unlink(missing_ok=True)
        return ''

    def records(self):
        with sqlite3.connect(self.db) as db:
            return [x[0] for x in db.execute('select name from records')]

    def test_update_keeps_existing_database_and_bootstrap_file(self):
        (self.target/'admin.key').write_text('original-bootstrap')
        with patch.object(c, 'utility', side_effect=self.utility), patch.object(c, 'compose'), patch.object(c, 'smoke'):
            c.deploy(self.target, self.new, 'different-environment-secret')
        self.assertEqual(self.records(), ['existing member'])
        self.assertEqual((self.target/'admin.key').read_text(), 'original-bootstrap')
        self.assertEqual(c.read(self.target/'current.json'), self.new)
        self.assertFalse((self.target/'data/.deployment-paused').exists())
        self.assertFalse((self.target/'transaction.json').exists())

    def test_failed_migration_restores_matching_database_and_old_image(self):
        def smoke(target, state, maintenance=False):
            if state == self.new:
                self.assertTrue(maintenance)
                self.assertTrue((target/'data/.deployment-paused').exists())
                with sqlite3.connect(self.db) as db:
                    db.execute("insert into records values ('candidate migration')")
                raise RuntimeError('failed candidate')
        with patch.object(c, 'utility', side_effect=self.utility), patch.object(c, 'compose') as compose, patch.object(c, 'smoke', side_effect=smoke):
            with self.assertRaisesRegex(RuntimeError, 'failed candidate'):
                c.deploy(self.target, self.new, 'bootstrap')
        self.assertEqual(self.records(), ['existing member'])
        self.assertEqual(c.read(self.target/'current.json'), self.old)
        self.assertTrue(any(x.args[1] == self.old and x.args[2] == 'up' for x in compose.call_args_list))
        self.assertFalse((self.target/'transaction.json').exists())

    def test_close_stops_only_pr_container_and_keeps_database(self):
        with patch.object(c, 'compose') as compose:
            c.stop_preview(self.target)
        self.assertEqual(self.records(), ['existing member'])
        self.assertTrue((self.target/'current.json').exists())
        self.assertEqual(compose.call_args.args[1]['project'], 'orbat-pr-12')
        with self.assertRaises(ValueError): c.stop_preview(self.root/'production')

    def test_reopen_reuses_database_port_and_project(self):
        with patch.object(c, 'compose') as compose, patch.object(c, 'smoke'):
            c.deploy(self.target, self.old, 'not-used')
        self.assertEqual(c.allocate_port(self.target, [self.target]), 32001)
        self.assertEqual(self.records(), ['existing member'])
        self.assertEqual(compose.call_args.args[2], 'up')

    def test_ports_do_not_collide_with_retained_closed_prs(self):
        other = self.root/'previews/pr-13'
        self.assertEqual(c.allocate_port(other, [self.target]), 32002)

    def test_production_and_preview_storage_are_separate(self):
        prod = c.config(self.root/'production', 'a'*40, 'image', '192.168.1.20', 3000, True)
        p = prod['compose']['services']['terminal']; v=self.old['compose']['services']['terminal']
        self.assertNotEqual(p['volumes'][0], v['volumes'][0])
        self.assertEqual(p['environment']['ORBAT_DISABLE_AUTO_RENEW'], 'false')
        self.assertEqual(v['environment']['ORBAT_DISABLE_AUTO_RENEW'], 'true')
        self.assertEqual(p['restart'], 'unless-stopped')

    def test_imported_production_waits_for_explicit_approval(self):
        (self.root/'.deploy-enabled').touch()
        with patch.object(c, 'ROOT', self.root), patch.object(c, 'bind_address', return_value='192.168.1.20'), patch.object(c, 'api') as api:
            c.reconcile('production')
        api.assert_not_called()

    def test_main_recovers_interruption_even_when_new_ci_is_pending(self):
        (self.root/'.deploy-enabled').touch()
        (self.root/'production').mkdir()
        (self.root/'production/.migration-approved').touch()
        with patch.object(c, 'ROOT', self.root), patch.object(c, 'bind_address', return_value='192.168.1.20'), patch.object(c, 'recover') as recover, patch.object(c, 'api', return_value={'commit': {'sha': 'c'*40}}), patch.object(c, 'successful_run', return_value=None):
            c.reconcile('production')
        recover.assert_called_once_with(self.root/'production')

    def test_disabled_controller_changes_nothing(self):
        with patch.object(c, 'ROOT', self.root), patch.object(c, 'bind_address') as address:
            c.reconcile('preview')
        address.assert_not_called()

    def test_crash_after_commit_does_not_restore_old_snapshot(self):
        c.atomic(self.target/'current.json', self.new)
        c.atomic(self.target/'transaction.json', {'candidate': self.new})
        with patch.object(c, 'compose') as compose, patch.object(c, 'utility') as utility:
            c.recover(self.target)
        compose.assert_not_called(); utility.assert_called_once()
        self.assertFalse((self.target/'transaction.json').exists())


if __name__ == '__main__': unittest.main()
