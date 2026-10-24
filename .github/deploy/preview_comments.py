"""Idempotent GitHub PR deployment notifications."""
COMMENT_MARKER = '<!-- orbat-preview -->'


def update_comment(api, number, state=None, deleted=False):
    if type(number) is not int or number < 1:
        raise ValueError('Invalid PR number')
    if state:
        ingress = state.get('ingress', '')
        heading = 'Preview ready' if not ingress or ingress.startswith('Gateway route and HTTPS passed') else 'Preview deployed - check ingress'
        body = (COMMENT_MARKER + '\n### ' + heading + '\n\n'
                + f'**[Open preview]({state["origin"]})** - LAN access only.\n\n'
                + f'Deployed revision: `{state["revision"]}`\n\n'
                + 'This PR keeps its own database across updates. Production data is separate.'
                + ('\n\n**Ingress check:** ' + state['ingress'] if state.get('ingress') else ''))
    elif deleted:
        body = (COMMENT_MARKER + '\n### Preview removed\n\n'
                + 'This PR is closed or merged. Its container, route, database and backups were removed. '
                + 'Its package versions, PR caches and unused host images were cleaned up.')
    else:
        body = (COMMENT_MARKER + '\n### Preview stopped\n\n'
                + 'The container and route are stopped. This PR database is retained for reopening.')
    for page in range(1, 101):
        comments = api(f'issues/{number}/comments?per_page=100&page={page}')
        existing = next((comment for comment in comments
                         if comment.get('user', {}).get('login') == 'github-actions[bot]'
                         and COMMENT_MARKER in (comment.get('body') or '')), None)
        if existing:
            if existing['body'] != body:
                api(f'issues/comments/{int(existing["id"])}', 'PATCH', {'body': body})
            return
        if len(comments) < 100:
            api(f'issues/{number}/comments', 'POST', {'body': body})
            return
    raise RuntimeError('Incomplete comment inventory; refusing to create duplicate preview comment')


