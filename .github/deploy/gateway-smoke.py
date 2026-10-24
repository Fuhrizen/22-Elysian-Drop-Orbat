"""Exercise published app ports and restricted gateway on a disposable hosted runner."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

if os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
    raise SystemExit('Run this disposable-container check only on a GitHub-hosted runner.')
spec = importlib.util.spec_from_file_location('reconcile', Path(__file__).with_name('reconcile.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
with tempfile.TemporaryDirectory() as directory:
    c.ROOT = Path(directory)
    target = c.ROOT / 'previews/pr-1'
    (target / 'data').mkdir(parents=True)
    (target / 'admin.key').write_text('disposable-only')
    state = c.config(target, 'a'*40, 'node:24-bookworm-slim', '127.0.0.1', 32001)
    service = state['compose']['services']['terminal']
    # Use the real Compose network/port/security configuration with a tiny HTTP fixture.
    service['command'] = ['node', '-e', "require('node:http').createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({status:'ok',revision:'"+'a'*40+"',host:q.headers.host}))}).listen(3000,'0.0.0.0')"]
    service['healthcheck'] = {'test':['CMD','node','-e',"fetch('http://127.0.0.1:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], 'interval':'1s','timeout':'2s','retries':20,'start_period':'2s'}
    try:
        c.compose(target, state, 'up', '-d', '--wait', '--wait-timeout', '90')
        c.verify_published_port(target, state)
        with urlopen('http://127.0.0.1:32001/api/health', timeout=3) as response:
            assert json.load(response)['status'] == 'ok'
        for routes in ([], [state], [state]):
            c.gateway('127.0.0.1', routes)
            # Reload is asynchronous: probe the real Host route, not just nginx -t.
            if routes:
                for attempt in range(30):
                    try:
                        req = Request('http://127.0.0.1:8081/api/health', headers={'Host':'pr-1.22preview.ivenity.co.uk'})
                        with urlopen(req, timeout=2) as response:
                            result = json.load(response)
                            assert result['revision'] == 'a'*40
                            assert result['host'] == 'pr-1.22preview.ivenity.co.uk'
                        break
                    except (URLError, TimeoutError):
                        if attempt == 29: raise
                        time.sleep(0.5)
            for attempt in range(30):
                try:
                    with urlopen('http://127.0.0.1:8081/', timeout=1) as response:
                        raise AssertionError(f'Expected default-host 404, got {response.status}')
                except HTTPError as error:
                    if error.code == 404: break
                    raise
                except (URLError, TimeoutError):
                    if attempt == 29: raise
                    time.sleep(0.5)
        print('Published host port, real hostname proxying, restricted nginx and unchanged-route reconciliation passed.')
    finally:
        subprocess.run(['docker', 'logs', '--tail', '40', 'orbat-preview-gateway'], check=False)
        subprocess.run(['docker', 'rm', '-f', 'orbat-preview-gateway'], check=False)
        c.compose(target, state, 'down', '--remove-orphans')

