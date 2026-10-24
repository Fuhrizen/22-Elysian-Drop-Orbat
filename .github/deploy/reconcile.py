#!/usr/bin/env python3
"""Reconcile trusted main builds and approved PR images without checking out PR code."""
import fcntl
import signal
import tempfile
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from preview_gateway import reconcile_gateway
from preview_comments import COMMENT_MARKER, update_comment
from preview_ingress import check_preview
from event_selection import select, github
from preview_cleanup import cleanup
from deployment_records import record_deployment

ROOT = Path('/srv/orbat')
REPOSITORY = os.environ.get('GITHUB_REPOSITORY', 'Fuhrizen/22-Elysian-Drop-Orbat')
APPROVED_AUTHORS = {'fuhrizen'}
ORIGIN = 'https://22orbat.ivenity.co.uk'
PREVIEW_DOMAIN = '22preview.ivenity.co.uk'
SOURCE = Path(__file__).resolve().parents[2]
UTILITY_IMAGE = 'node:24-bookworm-slim'


def command(args, extra=None):
    env = {k: v for k, v in os.environ.items()
           if k not in ('GH_TOKEN', 'GITHUB_TOKEN', 'ORBAT_ADMIN_ACCESS_KEY')}
    return subprocess.check_output(args, text=True, env={**env, **(extra or {})}).strip()


def api(path, method="GET", data=None):
    req = Request(f'https://api.github.com/repos/{REPOSITORY}/{path}', headers={
        'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
        'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'}, method=method,
        data=json.dumps(data).encode() if data is not None else None)
    with urlopen(req, timeout=30) as response:
        return json.load(response)


def bind_address():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.connect(('192.0.2.1', 80))
        address = sock.getsockname()[0]
    if not ipaddress.ip_address(address).is_private or address == '0.0.0.0':
        raise ValueError('VM default route must use a private IPv4 address')
    return address


def image_for(run, revision):
    prefix = 'main' if run['event'] == 'push' else f"pr-{int(run['pr_number'])}"
    tag = f"ghcr.io/{REPOSITORY.lower()}:{prefix}-run-{int(run['id'])}-{int(run['run_attempt'])}"
    command(['docker', 'pull', tag])
    info = json.loads(command(['docker', 'image', 'inspect', tag]))[0]
    labels = info['Config'].get('Labels') or {}
    if (labels.get('org.opencontainers.image.revision') != revision or
            labels.get('org.opencontainers.image.source') != 'https://github.com/' + REPOSITORY):
        raise ValueError('Image source/revision mismatch')
    prefix = f'ghcr.io/{REPOSITORY.lower()}@sha256:'
    return next(d for d in info['RepoDigests'] if d.startswith(prefix))


def release_image(target, run, revision):
    previous = read(target / 'current.json')
    if previous and previous['revision'] == revision:
        image = previous['compose']['services']['terminal']['image']
        if image.startswith(f'ghcr.io/{REPOSITORY.lower()}@sha256:'):
            return image
    return image_for(run, revision)


def atomic(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def read(path):
    return json.loads(path.read_text()) if path.exists() else None


def config(target, revision, image, address, port, production=False):
    name = target.name
    if name != 'production' and not re.fullmatch(r'pr-[1-9][0-9]*', name):
        raise ValueError('Invalid deployment target')
    origin = ORIGIN if production else f'https://{name}.{PREVIEW_DOMAIN}'
    service = {
        'image': image, 'restart': 'unless-stopped', 'init': True, 'read_only': True,
        'tmpfs': ['/tmp:rw,noexec,nosuid,size=64m'],
        'ports': [f'{address}:{port}:3000'],
        'environment': {'SITE_ORIGIN': origin, 'TRUST_PROXY': 'true',
                        'ADMIN_ACCESS_KEY_FILE': '/run/secrets/admin_key',
                        'ORBAT_DISABLE_AUTO_RENEW': 'false' if production else 'true',
                        'TZ': 'Europe/London',
                        'ORBAT_DEPLOYMENT_GUARD': '/app/data/.deployment-paused'},
        'volumes': [f'{target}/data:/app/data', f'{target}/admin.key:/run/secrets/admin_key:ro'],
        'mem_limit': '1280m' if production else '640m',
        'cpus': 1.0 if production else 0.35, 'pids_limit': 128,
        'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
        'stop_grace_period': '30s',
        'logging': {'driver': 'json-file', 'options': {'max-size': '5m', 'max-file': '2'}},
        'networks': ['app']}
    return {'project': 'orbat-' + name, 'revision': revision, 'port': port, 'origin': origin,
            'compose': {'services': {'terminal': service}, 'networks': {'app': {'driver': 'bridge'}}}}


def compose(target, state, *args):
    file = target / 'compose.json'
    atomic(file, state['compose'])
    return command(['docker', 'compose', '-p', state['project'], '-f', str(file), *args])


def utility(target, *args):
    return command(['docker', 'run', '--rm', '--network', 'none', '--user', '0',
                    '-v', f'{target}:/target',
                    '-v', f'{SOURCE}/scripts/snapshot.mjs:/snapshot.mjs:ro',
                    '-e', 'SQLITE_PATH=/target/data/regiment.sqlite',
                    '--entrypoint', 'node', UTILITY_IMAGE, *args])


def smoke(target, state, maintenance=False):
    compose(target, state, 'exec', '-T', '-e', 'EXPECT_REVISION=' + state['revision'],
            '-e', 'SMOKE_MAINTENANCE=' + str(maintenance).lower(),
            'terminal', 'node', 'scripts/smoke.mjs')


def release_guard(target):
    utility(target, '-e', "require('node:fs').rmSync('/target/data/.deployment-paused',{force:true})")


def verify_published_port(target, state):
    expected = state['compose']['services']['terminal']['ports'][0].rsplit(':', 1)[0]
    actual = compose(target, state, 'port', 'terminal', '3000')
    if expected not in actual.splitlines():
        raise RuntimeError(f'Host port is not published: expected {expected}; Docker returned {actual!r}')


def recover(target):
    tx = read(target / 'transaction.json')
    if not tx:
        return
    if read(target / 'current.json') == tx['candidate']:
        release_guard(target)
        (target / 'transaction.json').unlink()
        return
    compose(target, tx['candidate'], 'down')
    if tx['phase'] == 'candidate':
        if tx['had_database']:
            utility(target, '/snapshot.mjs', 'restore', '/target/' + tx['snapshot'])
            utility(target, '-e', "require('node:fs').chownSync('/target/data/regiment.sqlite',1000,1000)")
        else:
            utility(target, '-e', "const f=require('node:fs');for(const s of ['', '-wal', '-shm'])f.rmSync('/target/data/regiment.sqlite'+s,{force:true})")
    release_guard(target)
    if tx['previous']:
        compose(target, tx['previous'], 'up', '-d', '--wait', '--wait-timeout', '90')
        smoke(target, tx['previous'])
    (target / 'transaction.json').unlink()


def deploy(target, candidate, key, guard=None):
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    target.chmod(0o700)
    recover(target)
    previous = read(target / 'current.json')
    if guard:
        guard()
    if previous == candidate:
        compose(target, candidate, 'up', '-d', '--wait', '--wait-timeout', '90')
        verify_published_port(target, candidate)
        smoke(target, candidate)
        return
    if shutil.disk_usage(target).free < 2 * 1024**3:
        raise RuntimeError('Deployment needs at least 2 GiB of free disk')
    secret = target / 'admin.key'
    if not secret.exists() or (secret.stat().st_size == 0 and key):
        # Replace an empty read-only bootstrap file atomically as the runner user.
        with tempfile.NamedTemporaryFile(mode='w', dir=target, delete=False) as stream:
            stream.write(key)
            temporary_secret = Path(stream.name)
        temporary_secret.chmod(0o444)
        temporary_secret.replace(secret)  # Parent is private; runtime UID 1000 needs read access.
    (target / 'data').mkdir(exist_ok=True)
    (target / 'backups').mkdir(exist_ok=True)
    utility(target, '-e', "const f=require('node:fs'),p=require('node:path');function fix(n){const s=f.lstatSync(n);if(s.isSymbolicLink())throw Error('Symlink in data');if(s.isDirectory())for(const x of f.readdirSync(n))fix(p.join(n,x));f.chownSync(n,1000,1000);f.chmodSync(n,s.isDirectory()?448:384)}fix('/target/data')")
    had_database = utility(target, '-e', "console.log(require('node:fs').existsSync('/target/data/regiment.sqlite'))") == 'true'
    if not had_database and not key:
        raise ValueError('ADMIN_ACCESS_KEY is required to initialise an empty database')
    snapshot = f'backups/{time.time_ns()}.sqlite'
    tx = {'previous': previous, 'candidate': candidate, 'had_database': had_database,
          'snapshot': snapshot, 'phase': 'backup'}
    atomic(target / 'transaction.json', tx)
    try:
        utility(target, '-e', "require('node:fs').writeFileSync('/target/data/.deployment-paused','deployment in progress')")
        compose(target, previous or candidate, 'stop')
        if had_database:
            utility(target, '/snapshot.mjs', 'backup', '/target/' + snapshot)
        atomic(target / (snapshot + '.json'), tx)
        tx['phase'] = 'candidate'
        atomic(target / 'transaction.json', tx)
        if previous and previous['compose']['networks'] != candidate['compose']['networks']:
            # Internal/bridge mode is immutable; replace only this target's old network.
            compose(target, previous, 'down')
        compose(target, candidate, 'up', '-d', '--wait', '--wait-timeout', '90')
        verify_published_port(target, candidate)
        smoke(target, candidate, maintenance=True)
        if guard:
            guard()
        if previous:
            atomic(target / 'rollback.json', previous)
        atomic(target / 'current.json', candidate)
        release_guard(target)
        (target / 'transaction.json').unlink()
    except BaseException:
        recover(target)
        raise


def stop_preview(target):
    if not re.fullmatch(r'pr-[1-9][0-9]*', target.name):
        raise ValueError('Refusing to stop a non-PR target')
    recover(target)
    state = read(target / 'current.json')
    if state:
        compose(target, state, 'down', '--remove-orphans')
    # Keep current.json, bootstrap key, backups and the entire data directory for reopening.


def remove_preview(target):
    if (not re.fullmatch(r'pr-[1-9][0-9]*', target.name) or target.is_symlink()
            or target.parent.resolve() != (ROOT / 'previews').resolve()):
        raise ValueError('Refusing to delete a non-preview path')
    stop_preview(target)
    utility(target, '-e', "const f=require('node:fs');for(const n of ['data','backups'])f.rmSync('/target/'+n,{recursive:true,force:true})")
    shutil.rmtree(target)


def allocate_port(target, targets):
    previous = read(target / 'current.json')
    if previous:
        return previous['port']
    used = {s['port'] for p in targets if (s := read(p / 'current.json'))}
    for port in range(32001, 33000):
        if port not in used:
            return port
    raise RuntimeError('No free preview port; review retained PR allocations')


def gateway(address, states):
    reconcile_gateway(ROOT, address, states, command, PREVIEW_DOMAIN)


def summary(text):
    print(text, flush=True)
    if file := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(file, 'a') as stream:
            stream.write(text + '\n\n')


def preview_comment(number, state=None, deleted=False):
    update_comment(api, number, state, deleted=deleted)


def routes(address, excluded=None):
    states = []
    for target in sorted((ROOT / 'previews').glob('pr-*')):
        if target == excluded or (target / '.stopped').exists():
            continue
        if state := read(target / 'current.json'):
            states.append(state)
    gateway(address, states)


def ensure_current(plan):
    if plan['mode'] == 'production':
        valid = api('branches/main')['commit']['sha'] == plan['revision']
    else:
        pr = api(f"pulls/{plan['number']}")
        valid = (pr['state'] == 'open' and not pr['draft'] and
                 pr['head']['sha'] == plan['revision'])
    if not valid:
        raise RuntimeError('Superseded deployment; existing database/release retained. The newest event owns this target.')


def execute(plan):
    address = bind_address()
    key = os.environ.get('ORBAT_ADMIN_ACCESS_KEY', '')
    if plan['mode'] == 'production':
        target = ROOT / 'production'
        if not (target / '.migration-approved').exists():
            raise RuntimeError('Production is paused until the database import is approved')
    else:
        target = ROOT / 'previews' / f"pr-{plan['number']}"
        if plan['action'] != 'deploy':
            legacy = []
            if target.exists():
                for file in ('current.json', 'rollback.json'):
                    if old := read(target / file):
                        legacy.append(old['compose']['services']['terminal']['image'])
                if plan['action'] == 'remove':
                    tombstone = ROOT / f".cleanup-pr-{plan['number']}.json"
                    atomic(tombstone, sorted(set(legacy + (read(tombstone) or []))))
                routes(address, excluded=target)
                if plan['action'] == 'remove':
                    remove_preview(target)
                else:
                    stop_preview(target)
                    (target / '.stopped').touch()
            if plan['action'] == 'remove':
                # Retryable tombstone retains image identity if remote cleanup fails.
                tombstone = ROOT / f".cleanup-pr-{plan['number']}.json"
                legacy = sorted(set(legacy + (read(tombstone) or [])))
                atomic(tombstone, legacy)
                cleanup(plan['number'], ROOT, REPOSITORY, github, command, legacy)
                tombstone.unlink(missing_ok=True)
                preview_comment(plan['number'], deleted=True)
                summary(f"PR #{plan['number']}: preview, database, package versions, PR caches and unused host images removed.")
            else:
                preview_comment(plan['number'])
                summary(f"PR #{plan['number']}: draft preview stopped; database retained.")
            return
        if not read(target / 'current.json'):
            available = next(int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
            if available < 768 * 1024:
                raise RuntimeError('Preview needs VM memory headroom; production is unchanged. Retry this deployment after freeing memory.')
    # Recovery always precedes a new image change; recheck live state after acquiring host lock.
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    recover(target)
    ensure_current(plan)
    run = {**plan['run'], 'pr_number': plan['number']}
    port = 3000 if plan['mode'] == 'production' else allocate_port(target, list((ROOT / 'previews').glob('pr-*')))
    image = release_image(target, run, plan['revision'])
    candidate = config(target, plan['revision'], image,
                       address if plan['mode'] == 'production' else '127.0.0.1',
                       port, plan['mode'] == 'production')
    def finish():
        deploy(target, candidate, key, guard=lambda: ensure_current(plan))
        if plan['mode'] == 'preview':
            (target / '.stopped').unlink(missing_ok=True)
            routes(address)
            state = {**candidate, 'ingress': check_preview(candidate, address)}
            if 'certificate verification warning' in state['ingress']:
                print('::warning::' + state['ingress'])
            preview_comment(plan['number'], state)
            summary(f"PR #{plan['number']}: {candidate['origin']} / `{plan['revision']}` / {state['ingress']}")
            if not state['ingress'].startswith('Gateway route and HTTPS passed'):
                raise RuntimeError('Preview container passed smoke tests but ingress failed; see the PR comment for details')
        else:
            summary(f"Main: {ORIGIN} / `{plan['revision']}`; persistent database retained.")
    record_deployment(plan, candidate['origin'], api, finish)


def reconcile(mode):
    if mode != 'event':
        raise ValueError('Use event: deployments are selected from a completed GitHub workflow run')
    if not (ROOT / '.deploy-enabled').exists():
        raise RuntimeError('Deployment paused: /srv/orbat/.deploy-enabled is absent')
    plan = select(os.environ['DEPLOY_RUN_ID'], api)
    if not plan:
        summary('Superseded, failed or ineligible event; no changes made.')
        return
    execute(plan)


def interrupted(signum, frame):
    raise RuntimeError(f'Deployment interrupted by signal {signum}; transaction will be recovered')


if __name__ == '__main__':
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    with (ROOT / '.reconcile.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        reconcile(sys.argv[1])

