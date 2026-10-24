"""Associate deployment status with the actual application commit, not the controller."""
import os


def record_deployment(plan, origin, api, work):
    preview = plan['mode'] == 'preview'
    environment = 'development' if preview else 'main'
    deployment = api('deployments', 'POST', {
        'ref': plan['revision'], 'environment': environment, 'auto_merge': False,
        'required_contexts': [], 'transient_environment': preview,
        'production_environment': not preview,
        'description': f"PR #{plan['number']} preview" if preview else 'Production',
        'payload': {'pr': plan['number'], 'source_run': plan['run']['id']}})
    path = f"deployments/{int(deployment['id'])}/statuses"
    log_url = f"https://github.com/{os.environ.get('GITHUB_REPOSITORY','Fuhrizen/22-Elysian-Drop-Orbat')}/actions/runs/{os.environ.get('GITHUB_RUN_ID','')}"
    def status(state):
        api(path, 'POST', {'state': state, 'environment_url': origin,
                         'log_url': log_url, 'auto_inactive': not preview})
    status('in_progress')
    try:
        result = work()
    except BaseException:
        status('failure')
        raise
    status('success')
    return result
