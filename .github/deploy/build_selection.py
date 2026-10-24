"""Select exact source for the shared PR/main Build workflow."""
import json
import os
from event_selection import select, api

def resolve(event, request=api):
    if 'workflow_run' in event:
        plan = select(event['workflow_run']['id'], request, allow_ci=True)
        if not plan or plan['action'] != 'deploy' or plan['mode'] != 'preview':
            return {'enabled': 'false'}
        return {'enabled': 'true', 'revision': plan['revision'], 'target': f"pr-{plan['number']}", 'branch': request(f"pulls/{plan['number']}")['head']['ref']}
    revision = event['after']
    if event.get('ref') != 'refs/heads/main' or request('branches/main')['commit']['sha'] != revision:
        return {'enabled': 'false'}
    return {'enabled': 'true', 'revision': revision, 'target': 'main', 'branch': 'main'}

if __name__ == '__main__':
    with open(os.environ['GITHUB_EVENT_PATH']) as stream:
        result = resolve(json.load(stream))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        stream.write(''.join(f'{key}={value}\n' for key,value in result.items()))

