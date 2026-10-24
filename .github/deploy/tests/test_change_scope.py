import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).parents[1]))
from change_scope import classify, pr_scope
from event_selection import select
from build_selection import resolve
from test_events import run, pull


class Scope(unittest.TestCase):
    def test_workflow_only_runs_pipeline_without_preview(self):
        scope=classify(['.github/workflows/build.yml'])
        self.assertTrue(scope['pipeline']);self.assertFalse(scope['preview'])

    def test_test_only_runs_app_suite_without_image(self):
        scope=classify(['tests/api.test.mjs'])
        self.assertTrue(scope['app']);self.assertFalse(scope['preview'])

    def test_dependencies_require_audit_tests_and_preview(self):
        scope=classify(['pnpm-lock.yaml'])
        self.assertTrue(scope['dependencies'] and scope['app'] and scope['preview'])

    def test_runtime_assets_unknown_files_and_gateway_are_conservative(self):
        for path in ['public/robots.txt','public/help.md','unknown.config','app/page.tsx']:
            self.assertTrue(classify([path])['preview'])
        self.assertTrue(classify(['.github/deploy/preview_gateway.py'])['gateway'])

    def test_rename_from_runtime_to_docs_still_builds(self):
        def api(path):
            return [{'filename':'docs/page.md','previous_filename':'app/page.tsx'}] if '/files?' in path else pull()
        self.assertTrue(pr_scope(12,'a'*40,api)['preview'])

    def test_incomplete_diff_defaults_all_checks(self):
        def api(path):
            return [] if '/files?' in path else pull(changed_files=2)
        self.assertTrue(all(pr_scope(12,'a'*40,api).values()))

    def test_stale_pr_cannot_be_skipped(self):
        with self.assertRaises(RuntimeError): pr_scope(12,'b'*40,lambda _:pull())

    def test_reverted_runtime_diff_stops_previous_preview_and_skips_build(self):
        def api(path):
            if path.startswith('actions/runs/'):return run()
            if '/files?' in path:return [{'filename':'.github/workflows/ci.yml'}]
            return pull()
        self.assertEqual(resolve({'workflow_run':{'id':42}},api),{'enabled':'false'})
        def cleanup_api(path):
            return run(path='.github/workflows/preview-cleanup.yml') if path.startswith('actions/runs/') else api(path)
        self.assertEqual(select(42,cleanup_api)['action'],'stop')

    def test_main_metadata_push_skips_but_unavailable_comparison_builds(self):
        def api(path):
            if path=='branches/main':return {'commit':{'sha':'b'*40}}
            return {'files':[{'filename':'.github/workflows/build.yml'}]}
        event={'ref':'refs/heads/main','before':'a'*40,'after':'b'*40}
        self.assertEqual(resolve(event,api),{'enabled':'false'})
        def unavailable(path):
            if path.startswith('compare/'):raise RuntimeError('API unavailable')
            return api(path)
        self.assertEqual(resolve(event,unavailable)['target'],'main')
