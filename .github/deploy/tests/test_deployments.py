import io
import json
from pathlib import Path
import ssl
import sys
import unittest
from unittest.mock import Mock, patch
from urllib.error import URLError
sys.path.insert(0,str(Path(__file__).parents[1]))
import preview_ingress as ingress
from deployment_records import record_deployment


class Certificates(unittest.TestCase):
    def probe(self, revision):
        state={'origin':'https://pr-17.22preview.ivenity.co.uk','revision':'a'*40}
        body=lambda rev: io.StringIO(json.dumps({'status':'ok','revision':rev}))
        with patch.object(ingress,'build_opener') as opener:
            opener.return_value.open.side_effect=[body('a'*40),URLError(ssl.SSLCertVerificationError('self signed')),body(revision)]
            return ingress.check_preview(state,'192.168.1.173')

    def test_certificate_warning_allowed_only_after_expected_revision_verified(self):
        self.assertIn('certificate verification warning', self.probe('a'*40))

    def test_wrong_revision_remains_failure_with_untrusted_certificate(self):
        self.assertFalse(self.probe('b'*40).startswith('Gateway route and HTTPS passed'))


class Deployments(unittest.TestCase):
    def test_success_is_attached_to_preview_commit_and_does_not_inactivate_other_previews(self):
        api=Mock(return_value={'id':123})
        plan={'mode':'preview','revision':'a'*40,'number':17,'run':{'id':42}}
        record_deployment(plan,'https://pr-17.example',api,lambda:None)
        data=api.call_args_list[0].args[2]
        self.assertEqual(data['ref'],'a'*40)
        self.assertEqual(data['environment'],'development')
        self.assertFalse(data['auto_merge'])
        self.assertTrue(data['transient_environment'])
        self.assertEqual([c.args[2]['state'] for c in api.call_args_list[1:] if c.args[0].startswith('deployments/')],['in_progress','success'])
        self.assertFalse([c.args[2] for c in api.call_args_list if c.args[0].startswith('deployments/')][-1]['auto_inactive'])

    def test_application_failure_marks_deployment_failed(self):
        api=Mock(return_value={'id':123})
        def fail(): raise RuntimeError('smoke failed')
        with self.assertRaisesRegex(RuntimeError,'smoke failed'):
            record_deployment({'mode':'preview','revision':'a'*40,'number':17,'run':{'id':42}},'https://pr-17.example',api,fail)
        self.assertEqual(api.call_args.args[2]['state'],'failure')

