"""Nginx preview routing and restricted container lifecycle."""
import json
import re
import subprocess
import time


def reconcile_gateway(root, address, states, command, preview_domain):
    directory = root / 'gateway'
    directory.mkdir(exist_ok=True)
    routes = ['server { listen ' + address + ':8081 default_server; return 404; }']
    for state in states:
        host = state['origin'].removeprefix('https://')
        if not re.fullmatch(r'pr-[1-9][0-9]*\.' + re.escape(preview_domain), host):
            raise ValueError('Invalid preview hostname')
        port = int(state['port'])
        routes.append(f'''server {{ listen {address}:8081; server_name {host};
 location / {{ proxy_pass http://127.0.0.1:{port}; proxy_set_header Host $host;
 proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }} }}''')
    configuration = ('pid /tmp/nginx.pid; error_log /dev/stderr; events {} http { '
                     'access_log /dev/stdout; client_body_temp_path /tmp/client; '
                     'proxy_temp_path /tmp/proxy; fastcgi_temp_path /tmp/fastcgi; '
                     'uwsgi_temp_path /tmp/uwsgi; scgi_temp_path /tmp/scgi;\n' + '\n'.join(routes) + '\n}')
    directory.chmod(0o755)  # Only gateway config is mounted; nginx must traverse it.
    config_file = directory / 'nginx.conf'
    containers = command(['docker', 'ps', '-a', '--format', '{{.Names}}']).splitlines()
    exists = 'orbat-preview-gateway' in containers
    old = json.loads(command(['docker', 'inspect', 'orbat-preview-gateway']))[0] if exists else None
    if (old and old['Config'].get('User') == 'nginx' and old['State'].get('Running')
            and old['State'].get('Status') == 'running'
            and config_file.exists() and config_file.read_text() == configuration):
        return
    pending = directory / 'pending.conf' 
    pending.write_text(configuration)
    pending.chmod(0o444)
    runtime = ['--network', 'host', '--user', 'nginx', '--read-only',
               '--tmpfs', '/tmp:rw,nosuid,size=32m,mode=1777', '--cap-drop', 'ALL',
               '--security-opt', 'no-new-privileges:true', '--memory', '64m', '--cpus', '0.1',
               '-v', f'{directory}:/etc/orbat:ro', '--entrypoint', 'nginx']
    # Validate with the SAME user, capabilities, mounts and writable paths as runtime.
    command(['docker', 'run', '--rm', *runtime, 'nginx:stable-alpine',
             '-c', '/etc/orbat/pending.conf', '-t'])
    pending.replace(directory / 'nginx.conf')
    if exists:
        # Migrate the existing root/cap-drop container, including a restart loop.
        if old['Config'].get('User') != 'nginx':
            command(['docker', 'rm', '-f', 'orbat-preview-gateway'])
            exists = False
    if not exists:
        command(['docker', 'run', '-d', '--name', 'orbat-preview-gateway',
                 '--restart', 'unless-stopped', *runtime,
                 '--log-opt', 'max-size=5m', '--log-opt', 'max-file=2',
                 'nginx:stable-alpine', '-c', '/etc/orbat/nginx.conf', '-g', 'daemon off;'])
    else:
        command(['docker', 'start', 'orbat-preview-gateway'])
    # Do not exec into a container until its master is running and accepting signals.
    for attempt in range(20):
        state = json.loads(command(['docker', 'inspect', 'orbat-preview-gateway']))[0]['State']
        if state.get('Status') in ('restarting', 'exited', 'dead'):
            break
        if state.get('Running'):
            try:
                command(['docker', 'exec', 'orbat-preview-gateway', 'nginx',
                         '-c', '/etc/orbat/nginx.conf', '-s', 'reload'])
                return
            except subprocess.CalledProcessError:
                pass
        time.sleep(0.5)
    logs = command(['docker', 'logs', '--tail', '60', 'orbat-preview-gateway'])
    raise RuntimeError('Preview gateway failed startup; inspect docker logs orbat-preview-gateway.\n' + logs)

