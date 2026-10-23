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


class PortMapping(unittest.TestCase):
    def test_missing_mapping_is_rejected_even_if_container_is_healthy(self):
        target=Path('/srv/orbat/previews/pr-12')
        state=c.config(target,'a'*40,'image','127.0.0.1',32001)
        with patch.object(c,'compose',return_value=''):
            with self.assertRaisesRegex(RuntimeError,'not published'):c.verify_published_port(target,state)
        with patch.object(c,'compose',return_value='127.0.0.1:32001'):
            c.verify_published_port(target,state)


class Comments(unittest.TestCase):
    def setUp(self):
        self.state = {'origin': 'https://pr-12.22preview.ivenity.co.uk', 'revision': 'a'*40}

    def test_first_ready_comment_has_url_revision_and_lan_notice(self):
        with patch.object(c, 'api', return_value=[]) as api:
            c.preview_comment(12, self.state)
        path, method, data = api.call_args.args
        self.assertEqual((path, method), ('issues/12/comments', 'POST'))
        self.assertIn(self.state['origin'], data['body'])
        self.assertIn(self.state['revision'], data['body'])
        self.assertIn('LAN access only', data['body'])

    def test_update_existing_bot_comment_without_duplicates(self):
        existing = {'id': 123, 'body': c.COMMENT_MARKER+' old revision',
                    'user': {'login': 'github-actions[bot]'}}
        with patch.object(c, 'api', return_value=[existing]) as api:
            c.preview_comment(12, self.state)
        self.assertEqual(api.call_args.args[:2], ('issues/comments/123', 'PATCH'))

    def test_same_comment_does_not_send_another_notification(self):
        with patch.object(c, 'api', return_value=[]) as api:
            c.preview_comment(12, self.state)
            body = api.call_args.args[2]['body']
        existing = {'id': 123, 'body': body, 'user': {'login': 'github-actions[bot]'}}
        with patch.object(c, 'api', return_value=[existing]) as api:
            c.preview_comment(12, self.state)
        self.assertEqual(api.call_count, 1)

    def test_user_supplied_marker_is_not_modified(self):
        spoof = {'id': 123, 'body': c.COMMENT_MARKER, 'user': {'login': 'outsider'}}
        with patch.object(c, 'api', return_value=[spoof]) as api:
            c.preview_comment(12, self.state)
        self.assertEqual(api.call_args.args[1], 'POST')

    def test_stopped_comment_removes_ready_link(self):
        with patch.object(c, 'api', return_value=[]) as api:
            c.preview_comment(12)
        body=api.call_args.args[2]['body']
        self.assertIn('Preview stopped', body)
        self.assertNotIn('Open preview', body)

    def test_existing_comment_is_found_on_later_pages(self):
        page = [{'body': 'other', 'user': {'login': 'someone'}}]*100
        existing = {'id': 124, 'body': c.COMMENT_MARKER, 'user': {'login': 'github-actions[bot]'}}
        with patch.object(c, 'api', side_effect=[page, [existing], {}]) as api:
            c.preview_comment(12, self.state)
        self.assertEqual(api.call_args.args[:2], ('issues/comments/124', 'PATCH'))


class Ingress(unittest.TestCase):
    def execute(self, second=None):
        import io
        import preview_ingress as ingress
        state={'origin':'https://pr-12.22preview.ivenity.co.uk','revision':'a'*40}
        payload=json.dumps({'status':'ok','revision':state['revision']})
        responses=[io.StringIO(payload), second or io.StringIO(payload)]
        with patch.object(ingress,'build_opener') as opener:
            opener.return_value.open.side_effect=responses
            return ingress.check_preview(state,'192.168.1.20')

    def test_success_verifies_gateway_and_full_https(self):
        self.assertIn('HTTPS passed',self.execute())

    def test_dns_failure_explains_cloudflare_record(self):
        import socket
        from urllib.error import URLError
        self.assertIn('Cloudflare',self.execute(URLError(socket.gaierror('missing'))))

    def test_npm_access_denial_explains_access_list(self):
        from urllib.error import HTTPError
        self.assertIn('HTTP 403',self.execute(HTTPError('https://preview',403,'Forbidden',{},None)))

    def test_empty_gateway_probe_checks_marker_on_deliberate_404(self):
        import preview_ingress as ingress
        from urllib.error import HTTPError
        error=HTTPError('https://pr-0',404,'Not Found',{'X-Orbat-Preview-Gateway':'ready'},None)
        with patch.object(ingress,'build_opener') as opener:
            opener.return_value.open.side_effect=error
            self.assertIn('NPM routing passed',ingress.check_gateway_ingress(c.PREVIEW_DOMAIN))

    def test_removed_comment_has_no_stale_link_or_retention_claim(self):
        with patch.object(c,'api',return_value=[]) as api:
            c.preview_comment(12,deleted=True)
        body=api.call_args.args[2]['body']
        self.assertIn('Preview removed',body)
        self.assertNotIn('Open preview',body)
        self.assertNotIn('retained',body)


class Gateway(unittest.TestCase):
    def execute(self, old_user=None, restarting=False):
        self.calls=[]
        def command(args, extra=None):
            self.calls.append(args)
            if args[1:3] == ['ps', '-a']:
                return 'orbat-preview-gateway' if old_user is not None else ''
            if args[1] == 'inspect':
                return json.dumps([{'Config': {'User': 'nginx' if old_user is None else old_user},
                    'State': {'Status': 'restarting' if restarting else 'running', 'Running': not restarting}}])
            if args[1] == 'logs': return 'startup failure details'
            return ''
        with tempfile.TemporaryDirectory() as directory, patch.object(c, 'ROOT', Path(directory)), patch.object(c, 'command', side_effect=command), patch.object(c.time, 'sleep'):
            c.gateway('192.168.1.20', [])

    def test_validation_and_runtime_use_same_nonroot_security_options(self):
        self.execute()
        runs=[x for x in self.calls if x[1]=='run']
        self.assertEqual(len(runs),2)
        for args in runs:
            self.assertEqual(args[args.index('--user')+1], 'nginx')
            self.assertIn('--read-only', args)
            self.assertIn('ALL', args)
            self.assertIn('/tmp:rw,nosuid,size=32m,mode=1777', args)
        self.assertIn('/etc/orbat/pending.conf',runs[0])

    def test_legacy_root_gateway_is_recreated_without_touching_apps(self):
        self.execute(old_user='')
        self.assertIn(['docker','rm','-f','orbat-preview-gateway'],self.calls)
        self.assertFalse(any('production' in ' '.join(x) for x in self.calls))

    def test_existing_nonroot_gateway_is_reloaded(self):
        self.execute(old_user='nginx')
        self.assertFalse(any(x[1]=='rm' for x in self.calls))
        self.assertTrue(any(x[1]=='exec' and x[-1]=='reload' for x in self.calls))

    def test_unchanged_routes_skip_validation_and_reload(self):
        calls=[]
        def command(args, extra=None):
            calls.append(args)
            if args[1:3] == ['ps','-a']: return 'orbat-preview-gateway'
            if args[1] == 'inspect':
                return json.dumps([{'Config':{'User':'nginx'},'State':{'Status':'running','Running':True}}])
            return ''
        with tempfile.TemporaryDirectory() as directory, patch.object(c,'ROOT',Path(directory)), patch.object(c,'command',side_effect=command):
            c.gateway('192.168.1.20',[])
            calls.clear()
            c.gateway('192.168.1.20',[])
        self.assertFalse(any(x[1] in ('run','start','exec','rm') for x in calls))

    def test_restart_failure_includes_diagnostics_instead_of_blind_exec(self):
        with self.assertRaisesRegex(RuntimeError,'startup failure details'):
            self.execute(old_user='nginx', restarting=True)
        self.assertFalse(any(x[1]=='exec' for x in self.calls))


class Persistence(unittest.TestCase):
    def setUp(self):
        mapping_patch = patch.object(c, 'verify_published_port')
        self.port_check = mapping_patch.start()
        self.addCleanup(mapping_patch.stop)
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

    def test_internal_network_is_migrated_without_resetting_database(self):
        self.old['compose']['networks']={'isolated':{'internal':True}}
        self.old['compose']['services']['terminal']['networks']=['isolated']
        c.atomic(self.target/'current.json',self.old)
        with patch.object(c,'utility',side_effect=self.utility), patch.object(c,'compose') as compose, patch.object(c,'smoke'):
            c.deploy(self.target,self.new,'bootstrap')
        self.assertTrue(any(x.args[1]==self.old and x.args[2]=='down' for x in compose.call_args_list))
        self.assertEqual(self.records(),['existing member'])
        self.assertEqual(self.new['compose']['networks'],{'app':{'driver':'bridge'}})
        self.assertEqual(self.new['compose']['services']['terminal']['ports'],['127.0.0.1:32001:3000'])

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

    def test_closed_pr_removes_only_its_preview_database(self):
        (self.root/'.deploy-enabled').touch()
        production=self.root/'production'
        production.mkdir(); (production/'important.sqlite').write_text('production retained')
        with patch.object(c,'ROOT',self.root), patch.object(c,'bind_address',return_value='192.168.1.20'), patch.object(c,'inventory',return_value=[]), patch.object(c,'api',return_value={'state':'closed'}), patch.object(c,'gateway'), patch.object(c,'check_gateway_ingress',return_value='fixture'), patch.object(c,'preview_comment') as comment, patch.object(c,'compose'), patch.object(c,'utility',side_effect=self.utility):
            c.reconcile('preview')
        self.assertFalse(self.target.exists())
        self.assertEqual((production/'important.sqlite').read_text(),'production retained')
        comment.assert_called_once_with(12,deleted=True)

    def test_draft_pr_stops_container_but_keeps_database(self):
        (self.root/'.deploy-enabled').touch()
        with patch.object(c,'ROOT',self.root), patch.object(c,'bind_address',return_value='192.168.1.20'), patch.object(c,'inventory',return_value=[pr(draft=True)]), patch.object(c,'api') as api, patch.object(c,'gateway'), patch.object(c,'check_gateway_ingress',return_value='fixture'), patch.object(c,'preview_comment') as comment, patch.object(c,'compose') as compose:
            c.reconcile('preview')
        self.assertEqual(self.records(),['existing member'])
        self.assertEqual(compose.call_args.args[2],'down')
        api.assert_not_called()
        comment.assert_called_once_with(12)

    def test_missing_pr_status_never_deletes_data(self):
        (self.root/'.deploy-enabled').touch()
        with patch.object(c,'ROOT',self.root), patch.object(c,'bind_address',return_value='192.168.1.20'), patch.object(c,'inventory',return_value=[]), patch.object(c,'api',side_effect=RuntimeError('API unavailable')), patch.object(c,'gateway'):
            with self.assertRaisesRegex(RuntimeError,'API unavailable'):
                c.reconcile('preview')
        self.assertEqual(self.records(),['existing member'])

    def test_cleanup_refuses_production_and_symlink_targets(self):
        with patch.object(c,'ROOT',self.root):
            with self.assertRaises(ValueError): c.remove_preview(self.root/'production')
            link=self.root/'previews/pr-99'; link.symlink_to(self.target,target_is_directory=True)
            with self.assertRaises(ValueError): c.remove_preview(link)
        self.assertTrue(self.db.exists())

    def test_reopen_reuses_database_port_and_project(self):
        with patch.object(c, 'compose') as compose, patch.object(c, 'smoke'):
            c.deploy(self.target, self.old, 'not-used')
        self.assertEqual(c.allocate_port(self.target, [self.target]), 32001)
        self.assertEqual(self.records(), ['existing member'])
        self.assertEqual(compose.call_args.args[2], 'up')

    def test_ports_do_not_collide_with_retained_closed_prs(self):
        other = self.root/'previews/pr-13'
        self.assertEqual(c.allocate_port(other, [self.target]), 32002)

    def test_same_revision_reuses_verified_digest_without_registry_pull(self):
        self.old['compose']['services']['terminal']['image'] = f'ghcr.io/{c.REPOSITORY.lower()}@sha256:verified'
        c.atomic(self.target/'current.json',self.old)
        with patch.object(c,'image_for') as fetch:
            image=c.release_image(self.target,{},'a'*40)
        self.assertTrue(image.endswith('@sha256:verified'))
        fetch.assert_not_called()
        with patch.object(c,'image_for',return_value='new image') as fetch:
            self.assertEqual(c.release_image(self.target,{},'b'*40),'new image')
        fetch.assert_called_once()

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
