#!/usr/bin/env python3
"""Trusted private-repository controller. Never check out application/PR code here."""
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
BASE_IMAGE = 'node:24-bookworm-slim'


def atomic(path, data):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def command(args, env=None):
    # GitHub tokens and bootstrap keys must never enter a child process by accident.
    clean = {k: v for k, v in os.environ.items() if k not in
             ('GH_TOKEN', 'GITHUB_TOKEN', 'ORBAT_ADMIN_ACCESS_KEY')}
    return subprocess.check_output(args, env={**clean, **(env or {})}, text=True).strip()


def api(repo, suffix):
    request = Request('https://api.github.com/repos/' + repo + '/' + suffix,
                      headers={'Accept': 'application/vnd.github+json',
                               'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                               'X-GitHub-Api-Version': '2022-11-28'})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def pages(repo, suffix):
    result = []
    for page in range(1, 101):
        batch = api(repo, suffix + ('&' if '?' in suffix else '?') + urlencode({'per_page': 100, 'page': page}))
        result.extend(batch)
        if len(batch) < 100:
            return result
    raise RuntimeError('Pagination limit reached; no cleanup performed')


def successful_run(repo, revision, branch, event):
    query = urlencode({'head_sha': revision, 'status': 'success', 'per_page': 30, 'event': event})
    runs = api(repo, 'actions/workflows/ci.yml/runs?' + query)['workflow_runs']
    return next((r for r in runs if r['head_sha'] == revision and r['head_branch'] == branch
                 and r['event'] == event and r['conclusion'] == 'success'
                 and (r.get('head_repository') or {}).get('full_name') == repo), None)


def eligible(pr, repo, authors):
    return (pr['state'] == 'open' and not pr['draft'] and pr['base']['ref'] == 'main'
            and (pr['head'].get('repo') or {}).get('full_name') == repo
            and pr['user']['login'].lower() in authors)


def image_for(repo, run, revision):
    tag = f"ghcr.io/{repo.lower()}:run-{int(run['id'])}-{int(run['run_attempt'])}"
    command(['docker', 'pull', tag])
    details = json.loads(command(['docker', 'image', 'inspect', tag]))[0]
    labels = details['Config'].get('Labels') or {}
    if labels.get('org.opencontainers.image.revision') != revision:
        raise RuntimeError('Image revision mismatch')
    if labels.get('org.opencontainers.image.source') != 'https://github.com/' + repo:
        raise RuntimeError('Image repository mismatch')
    prefix = f'ghcr.io/{repo.lower()}@sha256:'
    return next(d for d in details['RepoDigests'] if d.startswith(prefix))


def compose(config, *args):
    return command(['docker', 'compose', '--project-name', config['project'],
                    '-f', str(HERE / 'compose.yaml'), *args], config['env'])


def utility(target, *args):
    return command(['docker', 'run', '--rm', '--network', 'none', '--user', '0',
                    '--mount', f'type=bind,src={target},dst=/target',
                    '--mount', f'type=bind,src={HERE / "snapshot.mjs"},dst=/snapshot.mjs,readonly',
                    '-e', 'SQLITE_PATH=/target/data/regiment.sqlite',
                    '--entrypoint', 'node', BASE_IMAGE, *args])


def recover(target):
    journal = target / 'transaction.json'
    if not journal.exists():
        return
    tx = json.loads(journal.read_text())
    state = target / 'current.json'
    if state.exists() and json.loads(state.read_text()) == tx['candidate']:
        journal.unlink()  # Committed successfully before the process was interrupted.
        return
    print('Recovering interrupted deployment:', target.name, flush=True)
    compose(tx['candidate'], 'down')
    if tx['phase'] == 'candidate':
        if tx['had_database']:
            utility(target, '/snapshot.mjs', 'restore', '/target/' + tx['snapshot'])
            utility(target, '-e', "require('node:fs').chownSync('/target/data/regiment.sqlite',1000,1000)")
        else:
            utility(target, '-e', "for(const n of ['regiment.sqlite','regiment.sqlite-wal','regiment.sqlite-shm'])require('node:fs').rmSync('/target/data/'+n,{force:true})")
    if tx['previous']:
        compose(tx['previous'], 'up', '-d', '--wait', '--wait-timeout', '90')
    journal.unlink()


def smoke(config):
    compose(config, 'exec', '-T', '-e', 'EXPECT_REVISION=' + config['revision'],
            'terminal', 'node', 'scripts/smoke.mjs')


def deploy(target, config, key):
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    recover(target)
    current = target / 'current.json'
    previous = json.loads(current.read_text()) if current.exists() else None
    if previous == config:
        # Restart after host reboot without migrating or backing up an unchanged release.
        compose(config, 'up', '-d', '--wait', '--wait-timeout', '90')
        smoke(config)
        return
    import shutil
    if shutil.disk_usage(target).free < 2 * 1024**3:
        raise RuntimeError('Keep at least 2 GiB free before deploying; clean reviewed old images/backups')
    if not key:
        raise ValueError('ORBAT_ADMIN_ACCESS_KEY environment secret is required')
    secret = target / 'admin.key'
    secret.write_text(key)
    secret.chmod(0o444)  # Parent directory is 0700; container's non-root UID needs read access.
    (target / 'data').mkdir(exist_ok=True)
    (target / 'backups').mkdir(exist_ok=True)
    utility(target, '-e', "const f=require('node:fs');f.chownSync('/target/data',1000,1000);f.chmodSync('/target/data',0o700)")
    snapshot = 'backups/' + str(time.time_ns()) + '.sqlite'
    # Existence check via Docker also works when the SQLite directory is owned by UID 1000.
    had_database = utility(target, '-e', "console.log(require('node:fs').existsSync('/target/data/regiment.sqlite'))") == 'true'
    tx = {'candidate': config, 'previous': previous, 'snapshot': snapshot,
          'had_database': had_database, 'phase': 'backup'}
    atomic(target / 'transaction.json', tx)
    try:
        compose(previous or config, 'stop')
        if had_database:
            utility(target, '/snapshot.mjs', 'backup', '/target/' + snapshot)
        # Save the matching image/config before any candidate migrations execute.
        atomic(target / (snapshot + '.json'), tx)
        tx['phase'] = 'candidate'
        atomic(target / 'transaction.json', tx)
        compose(config, 'up', '-d', '--wait', '--wait-timeout', '90')
        smoke(config)
        atomic(current, config)
        (target / 'transaction.json').unlink()
        print('Deployed', target.name, config['revision'], flush=True)
    except BaseException:
        recover(target)
        raise


def configuration(target, project, image, revision, origin, bind, port, production=False):
    if not re.fullmatch(r'https://[a-z0-9.-]+', origin):
        raise ValueError('Only a bare HTTPS origin is accepted')
    address = ipaddress.ip_address(bind)
    if not address.is_private or address.is_unspecified:
        raise ValueError('Bind to an explicit private or loopback IP')
    if not 1024 <= int(port) <= 65535:
        raise ValueError('Invalid port')
    return {'project': project, 'revision': revision, 'env': {
        'ORBAT_IMAGE': image, 'ORBAT_TARGET_DIR': str(target),
        'ORBAT_SITE_ORIGIN': origin, 'ORBAT_BIND_ADDRESS': bind, 'ORBAT_HOST_PORT': str(port),
        'ORBAT_MEMORY_LIMIT': '1280m' if production else '640m',
        'ORBAT_CPU_LIMIT': '1.0' if production else '0.35',
        'ORBAT_DISABLE_AUTO_RENEW': 'false' if production else 'true'}}


def remove_preview(target):
    recover(target)
    current = target / 'current.json'
    if current.exists():
        compose(json.loads(current.read_text()), 'down', '--remove-orphans')
    # Only a validated pr-N child reaches here. Do not traverse arbitrary host paths.
    utility(target, '-e', "const f=require('node:fs');for(const n of ['data','backups'])f.rmSync('/target/'+n,{recursive:true,force:true})")
    import shutil
    shutil.rmtree(target)
    print('Removed preview', target.name, flush=True)


def gateway(root, bind, port, domain):
    directory = root / 'gateway'
    directory.mkdir(exist_ok=True)
    lines = ['events {}', 'http {', 'access_log /dev/stdout;', 'error_log /dev/stderr warn;',
             f'server {{ listen {bind}:{port} default_server; server_name _; return 404; }}']
    for target in sorted((root / 'previews').glob('pr-*')):
        state = target / 'current.json'
        if not state.exists():
            continue
        config = json.loads(state.read_text())
        upstream_port = int(config['env']['ORBAT_HOST_PORT'])
        lines.append(f'''server {{
 listen {bind}:{port}; server_name {target.name}.{domain};
 location / {{
  proxy_pass http://127.0.0.1:{upstream_port};
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-For $http_x_forwarded_for;
  add_header X-Robots-Tag "noindex, nofollow" always;
 }}
}}''')
    lines.append('}')
    pending = directory / 'nginx.pending.conf'
    pending.write_text('\n'.join(lines) + '\n')
    command(['docker', 'run', '--rm', '--network', 'host', '--mount',
             f'type=bind,src={pending},dst=/etc/nginx/nginx.conf,readonly', 'nginx:stable-alpine', 'nginx', '-t'])
    pending.replace(directory / 'nginx.conf')
    # Mount the directory so atomic file replacement is visible inside the container.
    exists = command(['docker', 'ps', '-aq', '--filter', 'name=^/orbat-preview-gateway$'])
    if exists:
        command(['docker', 'start', 'orbat-preview-gateway'])
        command(['docker', 'exec', 'orbat-preview-gateway', 'nginx', '-c', '/etc/orbat/nginx.conf', '-s', 'reload'])
    else:
        command(['docker', 'run', '-d', '--name', 'orbat-preview-gateway', '--restart', 'unless-stopped',
                 '--network', 'host', '--read-only', '--tmpfs', '/var/cache/nginx', '--tmpfs', '/var/run',
                 '--mount', f'type=bind,src={directory},dst=/etc/orbat,readonly',
                 '--log-opt', 'max-size=5m', '--log-opt', 'max-file=2',
                 'nginx:stable-alpine', 'nginx', '-c', '/etc/orbat/nginx.conf', '-g', 'daemon off;'])


def reconcile(mode):
    if os.environ.get('ORBAT_ENABLED') != 'true':
        print('Deployment disabled; set this environment ORBAT_ENABLED=true after provisioning.')
        return
    repo = os.environ['ORBAT_SOURCE_REPOSITORY']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('Invalid repository')
    raw_root = Path(os.environ.get('ORBAT_ROOT') or '/srv/orbat')
    if not raw_root.is_absolute() or raw_root.is_symlink() or raw_root.resolve() != raw_root:
        raise ValueError('ORBAT_ROOT must be an absolute, canonical directory')
    root = raw_root
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / 'deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        bind = os.environ['ORBAT_BIND_ADDRESS']
        if not ipaddress.ip_address(bind).is_private or ipaddress.ip_address(bind).is_unspecified:
            raise ValueError('Explicit private bind address required')
        port = int(os.environ.get('ORBAT_HOST_PORT') or ('3000' if mode == 'production' else '8081'))
        if not 1024 <= port <= 65535 or (mode == 'preview' and 32001 <= port <= 32008):
            raise ValueError('Invalid or reserved listener port')
        key = os.environ.get('ORBAT_ADMIN_ACCESS_KEY', '')
        # Source must be public: private-controller GITHUB_TOKEN is scoped to its own repository.
        if api(repo, '')['private']:
            raise RuntimeError('Make the audited source repository public before enabling this controller')
        if mode == 'production':
            target = root / 'production'
            if os.environ.get('ORBAT_PRODUCTION_READY') != 'true' or not (target / '.migration-approved').exists():
                raise RuntimeError('Production migration/rehearsal must be approved before first deployment')
            recover(target)
            revision = api(repo, 'git/ref/heads/main')['object']['sha']
            run = successful_run(repo, revision, 'main', 'push') or successful_run(repo, revision, 'main', 'workflow_dispatch')
            if not run:
                print('Main has no successful current CI run; retaining production.')
                return
            image = image_for(repo, run, revision)
            # Recheck after pulling: do not deploy a main revision that has already been superseded.
            if api(repo, 'git/ref/heads/main')['object']['sha'] != revision:
                print('Main moved during reconciliation; retry next run.')
                return
            deploy(target, configuration(target, 'orbat-production', image, revision,
                   os.environ['ORBAT_SITE_ORIGIN'], bind, port, True), key)
            summary(f"Production: {revision} — {os.environ['ORBAT_SITE_ORIGIN']}")
        else:
            limit = int(os.environ.get('ORBAT_PREVIEW_LIMIT') or '2')
            if not 1 <= limit <= 2:
                raise ValueError('This 4 GiB profile supports one or two previews; resize/review before raising the limit')
            domain = os.environ['ORBAT_PREVIEW_DOMAIN']
            if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}', domain):
                raise ValueError('Invalid preview domain')
            authors = {a.strip().lower() for a in os.environ['ORBAT_PREVIEW_AUTHORS'].split(',') if a.strip()}
            # Complete all API pagination before any destructive cleanup. API failure preserves previews.
            prs = pages(repo, 'pulls?state=open&sort=updated&direction=desc')
            wanted = [pr for pr in prs if eligible(pr, repo, authors)][:limit]
            wanted_names = {f"pr-{int(pr['number'])}" for pr in wanted}
            preview_root = root / 'previews'
            preview_root.mkdir(exist_ok=True)
            for target in preview_root.iterdir():
                if re.fullmatch(r'pr-[1-9][0-9]*', target.name) and target.is_dir() and target.name not in wanted_names:
                    remove_preview(target)
            try:
                for pr in wanted:
                    name = f"pr-{int(pr['number'])}"
                    target = preview_root / name
                    if target.exists():
                        recover(target)
                    revision = pr['head']['sha']
                    run = successful_run(repo, revision, pr['head']['ref'], 'pull_request')
                    if not run:
                        print(name, 'awaiting successful CI; retaining any last-good preview')
                        continue
                    image = image_for(repo, run, revision)
                    fresh = api(repo, 'pulls/' + str(pr['number']))
                    if not eligible(fresh, repo, authors) or fresh['head']['sha'] != revision:
                        continue
                    used = {int(json.loads(p.read_text())['env']['ORBAT_HOST_PORT'])
                            for p in preview_root.glob('pr-*/current.json') if p.parent != target}
                    available = next(p for p in range(32001, 32009) if p not in used)
                    deploy(target, configuration(target, 'orbat-' + name, image, revision,
                           f'https://{name}.{domain}', '127.0.0.1', available), key)
                    summary(f"{name}: https://{name}.{domain} — {revision} (LAN only)")
            finally:
                gateway(root, bind, port, domain)


def summary(line):
    print(line, flush=True)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
            output.write(line + '\n\n')


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ('production', 'preview'):
        raise SystemExit('Usage: reconcile.py production|preview')
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    reconcile(sys.argv[1])
