"""Exercise the real restricted gateway on a disposable GitHub-hosted runner."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

if os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
    raise SystemExit('Run this destructive disposable-container check only on a GitHub-hosted runner.')
spec = importlib.util.spec_from_file_location('reconcile', Path(__file__).with_name('reconcile.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
try:
    with tempfile.TemporaryDirectory() as directory:
        c.ROOT = Path(directory)
        # Create, then reconcile/reload the actual non-root container.
        route = {'origin': 'https://pr-1.22preview.ivenity.co.uk', 'port': 32001}
        for routes in ([], [route], [route]):
            c.gateway('127.0.0.1', routes)
            for attempt in range(30):
                try:
                    with urlopen('http://127.0.0.1:8081/', timeout=1) as response:
                        raise AssertionError(f'Expected default-host 404, got {response.status}')
                except HTTPError as error:
                    if error.code == 404:
                        break
                    raise
                except (URLError, TimeoutError):
                    if attempt == 29:
                        raise
                    time.sleep(0.5)
        print('Gateway serves HTTP as non-root with read-only root and no capabilities; reload passed.')
finally:
    subprocess.run(['docker', 'logs', '--tail', '40', 'orbat-preview-gateway'], check=False)
    subprocess.run(['docker', 'rm', '-f', 'orbat-preview-gateway'], check=False)
