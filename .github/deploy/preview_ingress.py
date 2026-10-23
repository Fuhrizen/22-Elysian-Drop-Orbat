"""Probe gateway routing and LAN HTTPS separately without changing ingress settings."""
import json
import socket
import ssl
from urllib.error import HTTPError, URLError
from urllib.request import Request, ProxyHandler, build_opener, HTTPSHandler


def check_preview(state, address):
    opener = build_opener(ProxyHandler({}), HTTPSHandler(context=ssl.create_default_context()))
    def verify(url, headers=None):
        with opener.open(Request(url, headers=headers or {}), timeout=5) as response:
            data = json.load(response)
            if data.get('status') != 'ok' or data.get('revision') != state['revision']:
                raise ValueError('Unexpected application revision')
    try:
        verify(f'http://{address}:8081/api/health', {'Host': state['origin'].split('://', 1)[1]})
    except (OSError, ValueError, HTTPError, URLError):
        return 'Gateway route check failed. Check the gateway logs and preview container.'
    try:
        verify(state['origin'] + '/api/health')
    except HTTPError as error:
        return (f'Gateway route passed; HTTPS returned HTTP {error.code}. '
                'Check the NPM wildcard host, LAN access list and upstream port 8081.')
    except URLError as error:
        if isinstance(error.reason, socket.gaierror):
            return ('Gateway route passed; preview hostname did not resolve on the VM. '
                    'Check the DNS-only Cloudflare wildcard record pointing to NPM.')
        if isinstance(error.reason, ssl.SSLCertVerificationError):
            return ('Gateway route passed; HTTPS certificate verification failed. '
                    'Check the NPM wildcard certificate and hostname.')
        return ('Gateway route passed; HTTPS could not connect from the VM. '
                'Check wildcard DNS, NPM, port 8081 and firewall rules.')
    except (OSError, ValueError):
        return 'Gateway route passed; HTTPS did not return the expected revision. Check the NPM upstream.'
    return 'Gateway route and HTTPS passed from the deployment VM. Preview access is LAN only.'


def check_gateway_ingress(domain):
    # An unknown PR host should reach our deliberate 404, even with no active previews.
    opener = build_opener(ProxyHandler({}), HTTPSHandler(context=ssl.create_default_context()))
    try:
        with opener.open(f'https://pr-0.{domain}/', timeout=5):
            return 'Unexpected HTTPS response; verify the wildcard NPM upstream is this VM port 8081.'
    except HTTPError as error:
        if error.code == 404 and error.headers.get('X-Orbat-Preview-Gateway') == 'ready':
            return 'Wildcard DNS, TLS and NPM routing passed from the VM; unknown/closed PRs correctly return 404.'
        return f'HTTPS returned HTTP {error.code} without the gateway marker; check the NPM host, LAN access list and upstream.'
    except URLError as error:
        if isinstance(error.reason, socket.gaierror):
            return 'DNS lookup failed on the VM; configure DNS-only *.22preview.ivenity.co.uk to the NPM LAN address.'
        if isinstance(error.reason, ssl.SSLCertVerificationError):
            return 'TLS certificate verification failed; configure the NPM preview wildcard certificate.'
        return 'HTTPS connection failed from the VM; check wildcard DNS, NPM and firewall access to port 8081.'
    except OSError:
        return 'HTTPS connection failed from the VM; check wildcard DNS, NPM and firewall access to port 8081.'
