"""Read bounded JSON provenance from an artifact belonging to the verified Build run."""
import io
import json
import os
from urllib.request import Request, build_opener, HTTPRedirectHandler
import zipfile
from event_selection import REPOSITORY


def load_provenance(run, request):
    artifacts=request(f"actions/runs/{run['id']}/artifacts?per_page=100")['artifacts']
    matches=[a for a in artifacts if a['name']==f"release-{run['run_attempt']}" and not a['expired']]
    if len(matches)!=1:
        raise RuntimeError('Build provenance artifact is missing or ambiguous; rerun Build')
    artifact=matches[0]
    if artifact['size_in_bytes']>65536:
        raise RuntimeError('Invalid build provenance size')
    url=f"https://api.github.com/repos/{REPOSITORY}/actions/artifacts/{int(artifact['id'])}/zip"
    req=Request(url,headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
    class SafeRedirect(HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            redirected=super().redirect_request(request,fp,code,msg,headers,newurl)
            if redirected: redirected.remove_header('Authorization')
            return redirected
    with build_opener(SafeRedirect()).open(req,timeout=30) as response:
        data=response.read(65537)
    if len(data)>65536: raise RuntimeError('Build provenance archive too large')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entry=archive.getinfo('release.json')
        if entry.file_size>4096: raise RuntimeError('Build provenance JSON too large')
        result=json.loads(archive.read(entry))
    if result['build_run']!=run['id'] or result['attempt']!=run['run_attempt']:
        raise RuntimeError('Build provenance run mismatch')
    return result
