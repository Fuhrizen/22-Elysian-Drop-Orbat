import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).parents[1]))
from preview_readiness import ci_result
from deployment_records import record_deployment


class Readiness(unittest.TestCase):
    def run_ci(self, files, tests='success', changes='success', revision='a'*40):
        calls=[]
        def api(path, method='GET', data=None):
            if method=='POST': calls.append(data);return {}
            if '/files?' in path:return [{'filename':path} for path in files]
            return {'head':{'sha':revision},'changed_files':len(files)}
        ci_result(12,'a'*40,tests,changes,api)
        return calls

    def test_no_preview_required_passes(self):
        result=self.run_ci(['.github/workflows/build.yml'])[-1]
        self.assertEqual(result['state'],'success')
        self.assertEqual(result['description'],'No preview required')

    def test_runtime_change_waits_for_deployment(self):
        self.assertEqual(self.run_ci(['app/page.tsx'])[-1]['state'],'pending')

    def test_failed_ci_or_classifier_never_waives_preview(self):
        for tests,changes in [('failure','success'),('success','failure'),('skipped','success')]:
            self.assertEqual(self.run_ci(['README.md'],tests,changes)[-1]['state'],'failure')

    def test_old_run_does_not_update_current_sha(self):
        self.assertEqual(self.run_ci(['app/page.tsx'],revision='b'*40),[])

    def test_successful_deployment_completes_same_commit_gate(self):
        calls=[]
        def api(path,method='POST',data=None):
            calls.append((path,data));return {'id':1}
        plan={'mode':'preview','number':12,'revision':'a'*40,'run':{'id':42}}
        record_deployment(plan,'https://pr-12.example',api,lambda:None)
        statuses=[data for path,data in calls if path.startswith('statuses/')]
        self.assertEqual([s['state'] for s in statuses],['pending','success'])
        self.assertEqual(statuses[-1]['context'],'Preview readiness')

    def test_failed_deployment_fails_gate(self):
        calls=[]
        def api(path,method='POST',data=None):calls.append((path,data));return {'id':1}
        def fail():raise RuntimeError('smoke failed')
        with self.assertRaises(RuntimeError):
            record_deployment({'mode':'preview','number':12,'revision':'a'*40,'run':{'id':42}},'url',api,fail)
        self.assertEqual([data for path,data in calls if path.startswith('statuses/')][-1]['state'],'failure')
