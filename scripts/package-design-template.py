#!/usr/bin/env python3
"""Build the bundled PRD starter from an exact template Git commit."""

import argparse
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

INTERNAL_INSPECTOR = '@ali/uxer-inspector'
TEMPLATE_ARCHIVE = Path(__file__).resolve().parents[1] / 'src/main/resources/templates/uxer-fe-template.zip'


def community_template(files, source_commit):
    files = dict(files)
    files['.autowonder-template.json'] = (json.dumps({'sourceCommit': source_commit}) + '\n').encode()

    package = json.loads(files['package.json'])
    if INTERNAL_INSPECTOR in package['dependencies']:
        files['src/inspector/uxer.tsx'] = b"export { default } from './universal';\n"
        del package['dependencies'][INTERNAL_INSPECTOR]
        files['package.json'] = (json.dumps(package, indent=2) + '\n').encode()

        lock = files['pnpm-lock.yaml'].decode()
        # Remove the private package from importer, package and snapshot sections.
        lock, removed = re.subn(
            r"^(?P<indent> +)'@ali/uxer-inspector(?:@[^']+)?':\n"
            r"(?:(?P=indent) +[^\n]*\n)*",
            '',
            lock,
            flags=re.MULTILINE,
        )
        if removed != 3:
            raise ValueError('Unexpected inspector lockfile structure')
        files['pnpm-lock.yaml'] = lock.encode()
    if INTERNAL_INSPECTOR in files['pnpm-lock.yaml'].decode():
        raise ValueError('Unexpected private inspector dependency in lockfile')

    files['README.md'] = """# AutoWonder PRD Starter

This React and Vite project provides example routes, themes, and components for
a prototype. Run `pnpm install --frozen-lockfile` and `pnpm dev` to open it locally.
For an AutoWonder work item, run `pnpm dev:autowonder` in the design checkout.
The collaboration mode uses the public Inspector and supports element selection,
navigation, and hot updates. The execution runtime supplies the preview base
path and reads the bound port when starting the preview.
""".encode()
    return files


def write_archive(files, output):
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repository', type=Path)
    parser.add_argument('--ref', default='HEAD')
    args = parser.parse_args()

    def git(*argv):
        return subprocess.check_output(['git', '-C', str(args.repository), *argv])

    commit = git('rev-parse', '--verify', args.ref + '^{commit}').decode().strip()
    files = {}
    for raw in git('ls-tree', '-rz', '--name-only', commit).split(b'\0'):
        if not raw:
            continue
        name = raw.decode()
        parts = PurePosixPath(name).parts
        if any(part in {'.git', 'node_modules', 'dist', 'build'} for part in parts):
            continue
        if any(part.startswith('.env') and part != '.env.example' for part in parts):
            continue
        files[name] = git('show', f'{commit}:{name}')
    write_archive(community_template(files, commit), TEMPLATE_ARCHIVE)
    print(json.dumps({'sha256': hashlib.sha256(TEMPLATE_ARCHIVE.read_bytes()).hexdigest(),
                      'output': str(TEMPLATE_ARCHIVE)}))


if __name__ == '__main__':
    main()
