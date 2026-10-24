"""One commit status for conditional preview merge readiness."""
import os
from event_selection import api
from change_scope import pr_scope

CONTEXT = 'Preview readiness'


def publish(revision, state, description, request=api):
    request(f'statuses/{revision}', 'POST', {
        'state': state, 'context': CONTEXT, 'description': description,
        'target_url': f"https://github.com/{os.environ.get('GITHUB_REPOSITORY','Fuhrizen/22-Elysian-Drop-Orbat')}/actions/runs/{os.environ.get('GITHUB_RUN_ID','')}"})


def ci_result(number, revision, tests, changes, request=api):
    if request(f'pulls/{number}')['head']['sha'] != revision:
        return  # An old run must never update the latest commit's status.
    if tests != 'success' or changes != 'success':
        publish(revision, 'failure', 'CI or change detection failed', request)
        return
    try:
        scope = pr_scope(number, revision, request)
    except Exception:
        publish(revision, 'failure', 'Could not determine whether a preview is required', request)
        raise
    if scope['preview']:
        publish(revision, 'pending', 'Waiting for successful build and development deployment', request)
    else:
        publish(revision, 'success', 'No preview required', request)


if __name__ == '__main__':
    if os.environ['READINESS_STAGE'] == 'ci':
        ci_result(int(os.environ['PR_NUMBER']), os.environ['PR_REVISION'],
                  os.environ['TEST_RESULT'], os.environ['CHANGE_RESULT'])
    elif os.environ['BUILD_RESULT'] != 'success':
        publish(os.environ['REVISION'], 'failure', 'Preview build failed or was cancelled')
