import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))
from event_selection import select, outputs, REPOSITORY
from preview_cleanup import cleanup, owned_version


def pull(**changes):
    return {'number': 12, 'changed_files':1, 'state': 'open', 'draft': False, 'user': {'login': 'Fuhrizen'},
            'base': {'ref': 'main'}, 'head': {'sha': 'a'*40, 'ref': 'feature',
            'repo': {'full_name': REPOSITORY}}, **changes}


def run(**changes):
    return {'id': 42, 'run_attempt': 1, 'status': 'completed', 'conclusion': 'success',
            'event': 'pull_request', 'path': '.github/workflows/ci.yml', 'head_sha': 'a'*40,
            'head_branch': 'feature', 'head_repository': {'full_name': REPOSITORY},
            'pull_requests': [{'number': 12}], **changes}


class Events(unittest.TestCase):
    def resolve(self, event=None, pr=None, main='a'*40):
        def request(path):
            if path.startswith('actions/runs/'): return event or run()
            if path.startswith('commits/'): return [{'number': 12}]
            if path == 'branches/main': return {'commit': {'sha': main}}
            if '/files?' in path: return [{'filename':'app/page.tsx'}]
            if path == 'pulls/12': return pr or pull()
            raise AssertionError(path)
        return select(42, request, allow_ci=True)

    def test_active_pr_build_deploys_by_number_not_branch_name(self):
        plan = self.resolve(pr=pull(head={'sha':'a'*40,'ref':'renamed','repo':{'full_name':REPOSITORY}}))
        self.assertEqual((plan['number'], plan['action']), (12, 'deploy'))
        self.assertEqual(outputs(plan)['target'], 'pr-12')

    def test_old_failed_and_cancelled_active_builds_never_deploy(self):
        for event in [run(head_sha='b'*40), run(conclusion='failure'), run(conclusion='cancelled'), run(status='in_progress')]:
            self.assertIsNone(self.resolve(event))

    def test_closed_pr_cleans_up_even_if_its_build_was_cancelled(self):
        self.assertEqual(self.resolve(run(conclusion='cancelled'), pull(state='closed'))['action'], 'remove')

    def test_draft_stops_but_does_not_delete(self):
        self.assertEqual(self.resolve(pr=pull(draft=True))['action'], 'stop')

    def test_close_event_after_reopen_rechecks_live_revision(self):
        self.assertIsNone(self.resolve(run(head_sha='b'*40), pull()))

    def test_forks_unknown_authors_and_other_workflows_never_reach_vm(self):
        self.assertIsNone(self.resolve(run(head_repository={'full_name':'other/repo'})))
        self.assertIsNone(self.resolve(run(path='.github/workflows/other.yml')))
        self.assertIsNone(self.resolve(pr=pull(user={'login':'unknown'})))
        self.assertIsNone(self.resolve(pr=pull(head={'sha':'a'*40,'repo':{'full_name':'other/repo'}})))

    def test_missing_workflow_pr_metadata_uses_commit_association(self):
        self.assertEqual(self.resolve(run(pull_requests=[]))['number'], 12)

    def test_ambiguous_pr_association_is_not_guessed(self):
        self.assertIsNone(self.resolve(run(pull_requests=[{'number':12},{'number':13}])))

    def test_fresh_main_push_build_is_deployed_without_pr_tree_promotion(self):
        event = run(event='push',path='.github/workflows/build.yml',head_branch='main')
        plan=self.resolve(event)
        self.assertEqual((plan['mode'], plan['revision']), ('production','a'*40))
        self.assertIsNone(self.resolve(event, main='b'*40))
        self.assertIsNone(self.resolve({**event,'conclusion':'failure'}))

    def test_separate_cleanup_rechecks_live_state(self):
        event=run(path='.github/workflows/preview-cleanup.yml')
        self.assertEqual(self.resolve(event,pull(draft=True))['action'],'stop')
        self.assertEqual(self.resolve(event,pull(state='closed'))['action'],'remove')
        self.assertIsNone(self.resolve(event,pull()))

    def test_bad_run_ids_rejected_before_api(self):
        for value in ['../1','0','abc','1\n2']:
            with self.assertRaises(ValueError): select(value, lambda _: self.fail('API called'))


class Cleanup(unittest.TestCase):
    def version(self, tags, digest='sha256:preview'):
        return {'id':1,'name':digest,'metadata':{'container':{'tags':tags}}}

    def test_only_exclusively_owned_pr_versions_are_removed(self):
        self.assertTrue(owned_version(self.version(['pr-12-run-42-1']),12,set()))
        self.assertTrue(owned_version(self.version(['pr-12-run-42-1','run-42-1']),12,set()))
        self.assertFalse(owned_version(self.version(['pr-12-run-42-1','run-43-1']),12,set()))
        self.assertTrue(owned_version(self.version(['run-42-1']),12,set(),['image@sha256:preview']))
        for tags in [[], ['pr-13-run-42-1'], ['main-run-42-1'], ['run-42-1'], ['pr-12-run-42-1','main-run-43-1']]:
            self.assertFalse(owned_version(self.version(tags),12,set()))
        self.assertFalse(owned_version(self.version(['pr-12-run-42-1']),12,{'image@sha256:preview'}))

    def test_pr_cleanup_preserves_other_pr_caches_and_main_images(self):
        calls=[]
        def request(path, method='GET'):
            calls.append((path,method))
            if method=='DELETE': return None
            if path.endswith('/pulls/12'): return {'state':'closed'}
            if path==f'repos/{REPOSITORY}': return {'owner':{'type':'User'}}
            if '/packages/' in path: return [self.version(['pr-12-run-42-1']), {**self.version(['main-run-43-1']),'id':2}]
            return {'actions_caches':[{'id':7,'ref':'refs/pull/12/merge'},{'id':8,'ref':'refs/heads/main'}]}
        with tempfile.TemporaryDirectory() as directory:
            command=lambda args: ''
            cleanup(12,Path(directory),REPOSITORY,request,command)
        deleted=[path for path,method in calls if method=='DELETE']
        self.assertTrue(any(path.endswith('/versions/1') for path in deleted))
        self.assertTrue(any(path.endswith('/caches/7') for path in deleted))
        self.assertFalse(any(path.endswith(('/versions/2','/caches/8')) for path in deleted))

    def test_reopened_pr_prevents_all_cleanup(self):
        calls=[]
        def request(path,method='GET'):
            calls.append(path);return {'state':'open'}
        with tempfile.TemporaryDirectory() as directory:
            cleanup(12,Path(directory),REPOSITORY,request,lambda _: self.fail('Docker called'))
        self.assertEqual(len(calls),1)

    def test_incomplete_remote_inventory_fails_before_deleting_anything(self):
        calls=[]
        def request(path,method='GET'):
            calls.append(method)
            if path.endswith('/pulls/12'): return {'state':'closed'}
            if path==f'repos/{REPOSITORY}': return {'owner':{'type':'User'}}
            raise RuntimeError('API unavailable')
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError,'API unavailable'):
                cleanup(12,Path(directory),REPOSITORY,request,lambda _: '')
        self.assertNotIn('DELETE',calls)


if __name__ == '__main__': unittest.main()


