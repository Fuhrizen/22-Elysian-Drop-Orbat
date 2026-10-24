"""Resolve completed build events against live GitHub state; never trust PR artifacts."""
import json
import os
import re
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

REPOSITORY = os.environ.get('GITHUB_REPOSITORY', 'Fuhrizen/22-Elysian-Drop-Orbat')
APPROVED_AUTHORS = {'fuhrizen'}


def github(path, method='GET', data=None):
    request = Request('https://api.github.com/' + path.lstrip('/'), method=method,
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'},
        data=json.dumps(data).encode() if data is not None else None)
    with urlopen(request, timeout=30) as response:
        body = response.read()
        return json.loads(body) if body else None


def api(path, method='GET', data=None):
    return github(f'repos/{REPOSITORY}/{path}', method, data)


def select(run_id, request=api, allow_ci=False):
    if not re.fullmatch(r'[1-9][0-9]*', str(run_id)):
        raise ValueError('Invalid workflow run ID')
    run = request(f'actions/runs/{run_id}')
    if (run['status'] != 'completed' or not re.fullmatch(r'[a-f0-9]{40}', run['head_sha']) or
            (run.get('head_repository') or {}).get('full_name') != REPOSITORY):
        return None
    # The path/event pair prevents another workflow from impersonating a build.
    if run['path'] == '.github/workflows/build.yml' and run['event'] == 'push':
        if (run['head_branch'] != 'main' or run['conclusion'] != 'success' or
                run['head_sha'] != request('branches/main')['commit']['sha']):
            return None
        return {'mode': 'production', 'action': 'deploy', 'number': 0,
                'revision': run['head_sha'], 'run': run}
    if run['path'] == '.github/workflows/build.yml' and run['event'] == 'workflow_run':
        from build_provenance import load_provenance
        metadata = load_provenance(run, request)
        source_id = metadata['ci_run']
        if type(source_id) is not int or source_id < 1:
            raise RuntimeError('Invalid source CI run')
        parent = request(f'actions/runs/{source_id}')
        if parent['head_sha'] != metadata['revision']:
            raise RuntimeError('Build provenance revision mismatch')
        if parent['path'] != '.github/workflows/ci.yml' or parent['event'] != 'pull_request':
            return None
        plan = select(source_id, request, allow_ci=True)
        if not plan or plan['action'] != 'deploy' or plan['mode'] != 'preview':
            return None
        from change_scope import pr_scope
        if not pr_scope(plan['number'], plan['revision'], request)['preview']:
            return None
        return {**plan, 'run': run}
    if run['path'] == '.github/workflows/ci.yml' and not allow_ci:
        return None
    cleanup_event = run['path'] == '.github/workflows/preview-cleanup.yml'
    if run['path'] not in ('.github/workflows/ci.yml', '.github/workflows/preview-cleanup.yml') or run['event'] != 'pull_request':
        return None
    # workflow_run.pull_requests may be empty; commit association is authoritative too.
    pulls = run.get('pull_requests') or request(f'commits/{run["head_sha"]}/pulls?per_page=100')
    numbers = sorted({p['number'] for p in pulls})
    if any(type(number) is not int or number < 1 for number in numbers):
        raise ValueError('Invalid PR ownership metadata')
    if len(numbers) != 1:
        return None  # Never guess which PR owns a container or package.
    pr = request(f'pulls/{numbers[0]}')
    if ((pr['head'].get('repo') or {}).get('full_name') != REPOSITORY or
            pr['user']['login'].lower() not in APPROVED_AUTHORS or pr['base']['ref'] != 'main'):
        return None
    action = 'remove' if pr['state'] == 'closed' else 'stop' if pr['draft'] else 'deploy'
    if cleanup_event and action == 'deploy':
        from change_scope import pr_scope
        if pr_scope(pr['number'], pr['head']['sha'], request)['preview']:
            return None
        action = 'stop'
    if action == 'deploy' and (run['conclusion'] != 'success' or run['head_sha'] != pr['head']['sha']):
        return None
    return {'mode': 'preview', 'action': action, 'number': pr['number'],
            'revision': pr['head']['sha'], 'run': run}


def outputs(plan):
    if not plan:
        return {'enabled': 'false'}
    number = plan['number']
    label = 'main' if not number else f'PR #{number}'
    return {'enabled': 'true', 'mode': plan['mode'], 'target': 'main' if not number else f'pr-{number}',
            'environment': 'main' if not number else 'development',
            'name': f'{plan["action"].capitalize()} / {label}',
            'url': 'https://22orbat.ivenity.co.uk' if not number else f'https://pr-{number}.22preview.ivenity.co.uk'}


if __name__ == '__main__':
    # Automatic dispatch happens at the end of Build; wait for its final result.
    for attempt in range(30):
        if api('actions/runs/' + os.environ['DEPLOY_RUN_ID'])['status'] == 'completed':
            break
        time.sleep(2)
    plan = select(os.environ['DEPLOY_RUN_ID'])
    purpose = os.environ.get('DEPLOY_PURPOSE')
    if not plan and purpose == 'deploy':
        raise RuntimeError('No verified current deployment target; no container was updated. Check Build provenance and PR revision.')
    if plan and ((purpose == 'deploy' and plan['action'] != 'deploy') or (purpose == 'cleanup' and plan['action'] == 'deploy')):
        plan = None
    result = outputs(plan)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        stream.write(''.join(f'{key}={value}\n' for key, value in result.items()))
    print(result.get('name', 'Superseded, failed or ineligible run; no deployment.'))



