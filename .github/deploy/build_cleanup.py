"""Close the publish/PR-close race on the disposable image builder."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
from event_selection import select, github, REPOSITORY
from preview_cleanup import cleanup

if __name__ == '__main__':
    with open(os.environ['GITHUB_EVENT_PATH']) as stream:
        event = json.load(stream)
    plan = select(event['workflow_run']['id'], allow_ci=True)
    if plan and plan['mode'] == 'preview' and plan['action'] == 'remove':
        with tempfile.TemporaryDirectory() as directory:
            cleanup(plan['number'], Path(directory), REPOSITORY, github,
                    lambda args: subprocess.check_output(args, text=True).strip())
