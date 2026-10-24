import importlib.util
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

spec = importlib.util.spec_from_file_location('next_cache_cleanup', Path(__file__).parents[1] / 'preview_cleanup.py')
cleanup_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup_module)


class NextCacheCleanup(unittest.TestCase):
    def test_main_scoped_cache_requires_exact_pr_key_prefix(self):
        def item(key, ref='refs/heads/main'):
            return {'key': key, 'ref': ref}
        self.assertTrue(cleanup_module.owned_cache(item('next-v1-Linux-node24-pr-12-lock-source'), 12))
        for key in ['next-v1-Linux-node24-pr-123-lock-source',
                    'next-v1-Linux-node24-pr-1-lock-source',
                    'next-v1-Linux-node24-main-lock-source',
                    'Linux-node24-pnpm-lock', 'next-v2-Linux-node24-pr-12-lock']:
            self.assertFalse(cleanup_module.owned_cache(item(key), 12))
        self.assertFalse(cleanup_module.owned_cache(item('next-v1-Linux-node24-pr-12-lock', 'refs/heads/feature'), 12))
        self.assertTrue(cleanup_module.owned_cache(item('any-old-key', 'refs/pull/12/merge'), 12))

    def test_cleanup_scans_both_refs_before_deleting_only_owned_caches(self):
        deleted, refs = [], []
        def request(path, method='GET'):
            if method == 'DELETE': deleted.append(path); return None
            if path.endswith('/pulls/12'): return {'state': 'closed'}
            if path == 'repos/owner/repo': return {'owner': {'type': 'User'}}
            if '/packages/' in path: return []
            ref = parse_qs(urlsplit(path).query)['ref'][0]; refs.append(ref)
            if ref == 'refs/pull/12/merge':
                return {'actions_caches': [{'id': 1, 'ref': ref, 'key': 'old-pnpm'}]}
            return {'actions_caches': [
                {'id': 2, 'ref': ref, 'key': 'next-v1-Linux-node24-pr-12-lock-hash'},
                {'id': 3, 'ref': ref, 'key': 'next-v1-Linux-node24-pr-123-lock-hash'},
                {'id': 4, 'ref': ref, 'key': 'next-v1-Linux-node24-main-lock-hash'},
                {'id': 5, 'ref': ref, 'key': 'pnpm-store'},
            ]}
        with tempfile.TemporaryDirectory() as directory:
            cleanup_module.cleanup(12, Path(directory), 'owner/repo', request, lambda _: '')
        self.assertEqual(refs, ['refs/pull/12/merge', 'refs/heads/main'])
        self.assertEqual(deleted, ['repos/owner/repo/actions/caches/1', 'repos/owner/repo/actions/caches/2'])

    def test_failed_main_cache_inventory_does_not_partially_delete_merge_caches(self):
        deleted = []
        def request(path, method='GET'):
            if method == 'DELETE': deleted.append(path); return None
            if path.endswith('/pulls/12'): return {'state': 'closed'}
            if path == 'repos/owner/repo': return {'owner': {'type': 'User'}}
            if '/packages/' in path: return []
            ref = parse_qs(urlsplit(path).query)['ref'][0]
            if ref == 'refs/heads/main': raise RuntimeError('cache API unavailable')
            return {'actions_caches': [{'id': 1, 'ref': ref, 'key': 'old'}]}
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(RuntimeError, 'cache API unavailable'):
            cleanup_module.cleanup(12, Path(directory), 'owner/repo', request, lambda _: '')
        self.assertEqual(deleted, [])


if __name__ == '__main__': unittest.main()
