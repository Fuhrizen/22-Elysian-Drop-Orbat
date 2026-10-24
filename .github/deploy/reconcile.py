#!/usr/bin/env python3
"""Reconcile trusted main builds and approved PR images without checking out PR code."""
import fcntl
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
from preview_ingress import check_preview, check_gateway_ingress

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


def inventory():
    result = []
    for page in range(1, 101):
        batch = api(f'pulls?state=open&base=main&per_page=100&page={page}')
        result.extend(batch)
        if len(batch) < 100:
            return result
    raise RuntimeError('PR inventory incomplete; refusing cleanup')


def eligible(pr):
    return (pr['state'] == 'open' and not pr['draft'] and pr['base']['ref'] == 'main'
            and (pr['head'].get('repo') or {}).get('full_name') == REPOSITORY
            and pr['user']['login'].lower() in APPROVED_AUTHORS)


def target_name(pr):
    number = pr['number']
    if type(number) is not int or number < 1:
        raise ValueError('Invalid PR number')
    return f'pr-{number}'


def successful_run(revision, branch, event):
    query = urlencode({'head_sha': revision, 'event': event, 'status': 'success', 'per_page': 100})
    runs = api('actions/workflows/ci.yml/runs?' + query)['workflow_runs']
    return next((r for r in runs if r['head_sha'] == revision and r['head_branch'] == branch
                 and r['event'] == event and r['conclusion'] == 'success'
                 and (r.get('head_repository') or {}).get('full_name') == REPOSITORY), None)


def verified_main_release(revision):
    """Reuse PR CI only when the tested source tree exactly equals merged main."""
    pulls = api(f'commits/{revision}/pulls?per_page=100')
    for pr in pulls:
        if (not pr.get('merged_at') or pr.get('merge_commit_sha') != revision
                or pr['base']['ref'] != 'main'
                or (pr['head'].get('repo') or {}).get('full_name') != REPOSITORY):
            continue
        tested = pr['head']['sha']
        if api(f'git/commits/{revision}')['tree']['sha'] != api(f'git/commits/{tested}')['tree']['sha']:
            summary('Main keeps its current release: merged tree differs from tested PR; update and validate the PR before merging.')
            continue
        run = successful_run(tested, pr['head']['ref'], 'pull_request')
        if run:
            return run, tested, pr['number']
    return None


def bind_address():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.connect(('192.0.2.1', 80))
        address = sock.getsockname()[0]
    if not ipaddress.ip_address(address).is_private or address == '0.0.0.0':
        raise ValueError('VM default route must use a private IPv4 address')
    return address


def image_for(run, revision):
    tag = f"ghcr.io/{REPOSITORY.lower()}:run-{int(run['id'])}-{int(run['run_attempt'])}"
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


def deploy(target, candidate, key):
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    target.chmod(0o700)
    recover(target)
    previous = read(target / 'current.json')
    if previous == candidate:
        compose(target, candidate, 'up', '-d', '--wait', '--wait-timeout', '90')
        verify_published_port(target, candidate)
        smoke(target, candidate)
        return
    if shutil.disk_usage(target).free < 2 * 1024**3:
        raise RuntimeError('Deployment needs at least 2 GiB of free disk')
    secret = target / 'admin.key'
    if not secret.exists() or (secret.stat().st_size == 0 and key):
        secret.write_text(key)
        secret.chmod(0o444)  # Parent is private; runtime UID 1000 needs read access.
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


def reconcile(mode):
    if not (ROOT / '.deploy-enabled').exists():
        summary('Deployment paused: /srv/orbat/.deploy-enabled is absent.')
        return
    address = bind_address()
    key = os.environ.get('ORBAT_ADMIN_ACCESS_KEY', '')
    if mode == 'production':
        target = ROOT / 'production'
        if not (target / '.migration-approved').exists():
            summary('Main paused until the database import is approved.')
            return
        recover(target)
        revision = api('branches/main')['commit']['sha']
        release = verified_main_release(revision)
        if not release:
            summary('Main keeps its existing release: no successful PR image verified for this merged tree.')
            return
        run, tested, number = release
        candidate = config(target, tested, release_image(target, run, tested), address, 3000, True)
        candidate['main_revision'] = revision
        deploy(target, candidate, key)
        summary(f'Main: {ORIGIN} - merged `{revision}`, tested image `{tested}` from PR #{number}; persistent database retained.')
        return
    if mode != 'preview':
        raise ValueError('Expected production or preview')
    open_prs = {target_name(pr): pr for pr in inventory()}
    active = {name: pr for name, pr in open_prs.items() if eligible(pr)}
    preview_root = ROOT / 'previews'
    preview_root.mkdir(exist_ok=True)
    targets = list(preview_root.glob('pr-*'))
    # Remove routes first so closed/draft PRs never point at retained stopped containers.
    states = [state for p in targets if p.name in active and (state := read(p / 'current.json'))]
    gateway(address, states)
    for target in targets:
        if target.name not in active:
            number = int(target.name.removeprefix('pr-'))
            # Absence from the eligible list alone is not permission to delete data.
            pr = open_prs.get(target.name) or api(f'pulls/{number}')
            if pr['state'] == 'closed':
                remove_preview(target)
                summary(f'{target.name}: closed/merged; container, database and backups removed.')
                preview_comment(number, deleted=True)
            else:
                stop_preview(target)
                summary(f'{target.name}: stopped; database retained while PR remains open.')
                preview_comment(number)
    failures = []
    for name, pr in active.items():
        target = preview_root / name
        revision = pr['head']['sha']
        run = successful_run(revision, pr['head']['ref'], 'pull_request')
        try:
            if run:
                if not read(target / 'current.json'):
                    available = next(int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
                    if available < 768 * 1024:
                        summary(f'{name}: waiting for VM memory headroom; production unchanged.')
                        continue
                port = allocate_port(target, list(preview_root.glob('pr-*')))
                deploy(target, config(target, revision, release_image(target, run, revision), '127.0.0.1', port), key)
            elif state := read(target / 'current.json'):
                recover(target)
                compose(target, state, 'up', '-d', '--wait', '--wait-timeout', '90')
                smoke(target, state)
            else:
                summary(f'{name}: waiting for first successful CI build.')
                continue
            summary(f'PR #{pr["number"]} by @{pr["user"]["login"]}: https://{name}.{PREVIEW_DOMAIN}')
        except Exception as error:
            failures.append(name)
            print(f'{name}: {error}', file=sys.stderr)
    # Publish successfully committed state, including rollback state after a failed candidate.
    states = [state for p in preview_root.glob('pr-*') if p.name in active and (state := read(p / 'current.json'))]
    gateway(address, states)
    summary('Preview ingress: ' + check_gateway_ingress(PREVIEW_DOMAIN))
    for state in states:
        number = int(state['origin'].split('://pr-', 1)[1].split('.', 1)[0])
        if f'pr-{number}' not in failures:
            state = {**state, 'ingress': check_preview(state, address)}
            summary(f'PR #{number} ingress: {state["ingress"]}')
            preview_comment(number, state)
    if failures:
        raise RuntimeError('Some previews failed: ' + ', '.join(failures))


if __name__ == '__main__':
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (ROOT / '.reconcile.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        reconcile(sys.argv[1])

