"""Conservative, complete-diff classification shared by CI and release selection."""
import os
from event_selection import api


def classify(paths):
    scope = dict(app=False, pipeline=False, dependencies=False, gateway=False, preview=False)
    for path in paths:
        if path in ('package.json', 'pnpm-lock.yaml', '.npmrc'):
            scope.update(app=True, dependencies=True, preview=True)
        elif path.startswith('.github/'):
            scope['pipeline'] = True
            if path in ('.github/deploy/preview_gateway.py', '.github/deploy/reconcile.py', '.github/deploy/gateway-smoke.py'):
                scope['gateway'] = True
        elif path.startswith('tests/'):
            scope['app'] = True
        elif (path.lower().endswith(('.md', '.rst')) and not path.startswith(('app/','components/','public/','lib/'))) or ('/' not in path and path.lower().endswith('.txt')) or path.startswith(('docs/', '.vscode/')) or path in ('LICENSE', '.gitignore'):
            pass
        else:
            if path.startswith('deploy/') or path in ('Dockerfile','compose.yml','docker-compose.yml'):
                scope.update(pipeline=True, gateway=True)
            # Unknown files run full application coverage rather than silently skipping it.
            scope.update(app=True, preview=True)
    return scope


def pr_scope(number, revision, request=api):
    pr = request(f'pulls/{number}')
    if pr['head']['sha'] != revision:
        raise RuntimeError('PR changed while determining test/build scope')
    files = []
    for page in range(1, 32):
        batch = request(f'pulls/{number}/files?per_page=100&page={page}')
        files.extend(batch)
        if len(batch) < 100:
            break
    if len(files) != pr['changed_files'] or len(files) >= 3000:
        return dict.fromkeys(('app','pipeline','dependencies','gateway','preview'), True)
    if request(f'pulls/{number}')['head']['sha'] != revision:
        raise RuntimeError('PR changed while reading changed files')
    return classify(path for file in files for path in (file['filename'], file.get('previous_filename', file['filename'])))


if __name__ == '__main__':
    scope = pr_scope(int(os.environ['PR_NUMBER']), os.environ['PR_REVISION'])
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        stream.write(''.join(f'{key}={str(value).lower()}\n' for key,value in scope.items()))
    print('Change scope:', scope)
