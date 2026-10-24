import unittest
from unittest.mock import patch
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]))
from event_selection import select
from build_selection import resolve
from test_events import run, pull


class BuildChain(unittest.TestCase):
    def request(self, path):
        if path == 'actions/runs/42': return self.ci
        if path == 'actions/runs/84': return self.build
        if path == 'actions/runs/84/jobs?per_page=100': return {'jobs':[{'name':'Source','steps':[{'name':self.provenance}]}]}
        if '/files?' in path: return [{'filename':'app/page.tsx'}]
        if path == 'pulls/12': return self.pr
        if path == 'branches/main': return {'commit': {'sha':'c'*40}}
        raise AssertionError(path)

    def setUp(self):
        self.metadata=patch('build_provenance.load_provenance',return_value={'ci_run':42,'revision':'a'*40})
        self.metadata.start();self.addCleanup(self.metadata.stop)
        self.provenance="CI run 42"
        self.ci=run()
        self.pr=pull()
        self.build=run(id=84,event='workflow_run',path='.github/workflows/build.yml',
                       head_sha='c'*40,head_branch='main',display_title='Build / CI 42')

    def test_build_uses_pr_revision_and_deploy_uses_build_image_run(self):
        self.assertEqual(resolve({'workflow_run':{'id':42}},self.request),
                         {'enabled':'true','revision':'a'*40,'target':'pr-12','branch':'feature'})
        plan=select(84,self.request)
        self.assertEqual(plan['revision'],'a'*40)
        self.assertEqual(plan['run']['id'],84)
        self.assertIsNone(select(42,self.request))

    def test_failed_ci_stale_pr_and_invalid_build_provenance_do_not_deploy(self):
        self.ci['conclusion']='failure'
        self.assertIsNone(select(84,self.request))
        self.ci['conclusion']='success';self.pr['head']['sha']='b'*40
        self.assertIsNone(select(84,self.request))
        self.pr=pull();self.metadata.stop();self.metadata=patch('build_provenance.load_provenance',return_value={'ci_run':42,'revision':'wrong'})
        self.metadata.start();self.addCleanup(self.metadata.stop)
        with self.assertRaisesRegex(RuntimeError,'revision mismatch'): select(84,self.request)

    def test_main_push_builds_latest_main_without_ci(self):
        self.assertEqual(resolve({'ref':'refs/heads/main','after':'c'*40},self.request)['target'],'main')
        self.assertEqual(resolve({'ref':'refs/heads/main','after':'a'*40},self.request),{'enabled':'false'})

    def test_draft_or_closed_pr_does_not_build(self):
        for state in [pull(draft=True),pull(state='closed')]:
            self.pr=state
            self.assertEqual(resolve({'workflow_run':{'id':42}},self.request),{'enabled':'false'})


if __name__ == '__main__': unittest.main()

