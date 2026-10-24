"""Delete only a closed PR's package versions, caches and unused local images."""
import json
from pathlib import Path
import re
from urllib.error import HTTPError
from urllib.parse import quote, urlencode


def protected_images(root, excluded=None):
    images = set()
    for path in [root / 'production', *sorted((root / 'previews').glob('pr-*'))]:
        if path == excluded:
            continue
        for file in ('current.json', 'rollback.json', 'transaction.json'):
            entry = path / file
            if not entry.exists():
                continue
            def collect(value):
                if isinstance(value, dict):
                    if isinstance(value.get('image'), str):
                        images.add(value['image'])
                    for child in value.values():
                        collect(child)
                elif isinstance(value, list):
                    for child in value:
                        collect(child)
            collect(json.loads(entry.read_text()))
    return images


def owned_version(version, number, protected, legacy_images=()):
    tags = version.get('metadata', {}).get('container', {}).get('tags', [])
    digest = version['name']
    if digest in {image.split('@', 1)[-1] for image in protected}:
        return False
    own = {tag for tag in tags if re.fullmatch(fr'pr-{number}-run-[0-9]+-[0-9]+', tag)}
    aliases = {tag.removeprefix(f'pr-{number}-') for tag in own}
    if own:
        return all(tag in own or tag in aliases for tag in tags)
    # Pre-rollout images have only run-* tags; only remove digests recorded by this PR.
    return (digest in {image.split('@', 1)[-1] for image in legacy_images}
            and all(re.fullmatch(r'run-[0-9]+-[0-9]+', tag) for tag in tags))


def pages(request, path, key=None):
    rows = []
    separator = '&' if '?' in path else '?'
    for page in range(1, 1001):
        data = request(f'{path}{separator}per_page=100&page={page}')
        batch = data[key] if key else data
        rows.extend(batch)
        if len(batch) < 100:
            return rows
    raise RuntimeError('Incomplete cleanup inventory; nothing will be deleted')


def cleanup(number, root, repository, request, command, legacy_images=()):
    if type(number) is not int or number < 1:
        raise ValueError('Invalid PR number')
    # Recheck here too: a delayed close event must not clean up a reopened PR.
    if request(f'repos/{repository}/pulls/{number}')['state'] != 'closed':
        return
    protected = protected_images(root)
    repo = request(f'repos/{repository}')
    owner, name = repository.split('/')
    kind = 'orgs' if repo['owner']['type'] == 'Organization' else 'users'
    package = f'{kind}/{owner}/packages/container/{quote(name.lower(), safe="")}/versions'
    try:
        versions = pages(request, package)
    except HTTPError as error:
        if error.code != 404:
            raise RuntimeError('Package cleanup needs this repository to have Admin access to its GHCR package') from error
        versions = []
    cache_path = f'repos/{repository}/actions/caches?'+urlencode({'ref': f'refs/pull/{number}/merge'})
    caches = pages(request, cache_path, 'actions_caches')
    # All inventories must complete before any remote deletion.
    for version in versions:
        if owned_version(version, number, protected, legacy_images):
            try:
                request(f'{package}/{int(version["id"])}', 'DELETE')
            except HTTPError as error:
                if error.code != 404:
                    raise RuntimeError('Could not delete PR image version; check GHCR package Admin access') from error
    for cache in caches:
        if cache.get('ref') == f'refs/pull/{number}/merge':
            try:
                request(f'repos/{repository}/actions/caches/{int(cache["id"])}', 'DELETE')
            except HTTPError as error:
                if error.code != 404:
                    raise
    # No system/volume prune: only this PR's image references, never active/rollback digests.
    image_repository = 'ghcr.io/' + repository.lower()
    rows = command(['docker', 'image', 'ls', '--format', '{{json .}}'])
    targets = set(legacy_images) - protected
    for row in rows.splitlines():
        image = json.loads(row)
        if image['Repository'] == image_repository and re.fullmatch(fr'pr-{number}-run-[0-9]+-[0-9]+', image['Tag']):
            targets.add(image_repository + ':' + image['Tag'])
            targets.add(image_repository + ':' + image['Tag'].removeprefix(f'pr-{number}-'))
    protected_ids = set()
    for image in protected:
        # Recovery images referenced in state should be present locally. Fail closed if not.
        protected_ids.add(command(['docker', 'image', 'inspect', '--format', '{{.Id}}', image]))
    for image in sorted(targets):
        try:
            image_id = command(['docker', 'image', 'inspect', '--format', '{{.Id}}', image])
        except Exception:
            continue  # Already removed by an earlier cleanup event.
        if image_id not in protected_ids:
            command(['docker', 'image', 'rm', image])
