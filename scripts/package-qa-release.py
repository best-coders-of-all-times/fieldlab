"""Package a reviewed QA build and a patch against an untouched source checkout."""
import argparse
import difflib
import gzip
import hashlib
import json
from pathlib import Path
import tarfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    release = root / 'release'
    release.mkdir(exist_ok=True)
    candidates = [root / 'vite.config.ts', root / 'QA-UPDATE-PLAN.md']
    for directory in ['src', 'tests', 'scripts']:
        candidates.extend(p for p in (root / directory).rglob('*') if p.is_file())
    patch = []
    changed = []
    for file in sorted(candidates):
        relative = file.relative_to(root)
        baseline = args.baseline / relative
        old = baseline.read_text(encoding='utf-8') if baseline.exists() else ''
        new = file.read_text(encoding='utf-8')
        if old == new:
            continue
        path = relative.as_posix()
        changed.append(path)
        patch.append(f'diff --git a/{path} b/{path}\n')
        if not baseline.exists():
            patch.append('new file mode 100644\n')
        for line in difflib.unified_diff(old.splitlines(True), new.splitlines(True),
                                        fromfile=f'a/{path}' if baseline.exists() else '/dev/null',
                                        tofile=f'b/{path}'):
            patch.append(line)
            if not line.endswith('\n'):
                patch.append('\n\\ No newline at end of file\n')
    (release / 'source-update.patch').write_text(''.join(patch), encoding='utf-8', newline='\n')
    (release / 'changed-files.json').write_text(json.dumps(changed, indent=2) + '\n', encoding='utf-8')
    dist = root / 'dist'
    if not (dist / 'index.html').exists():
        raise SystemExit('Build dist before packaging')
    for file in sorted(dist.rglob('*')):
        if file.is_file() and file.suffix in {'.html', '.js', '.css', '.json', '.svg'}:
            Path(str(file) + '.gz').write_bytes(gzip.compress(file.read_bytes(), compresslevel=9, mtime=0))
    hashes = {p.relative_to(dist).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(dist.rglob('*')) if p.is_file()}
    (release / 'SHA256SUMS.json').write_text(json.dumps(hashes, indent=2) + '\n', encoding='utf-8')
    archive = release / 'fieldlab-static.tar.gz'
    with tarfile.open(archive, 'w:gz') as bundle:
        for file in sorted(dist.rglob('*')):
            if file.is_file():
                bundle.add(file, arcname=file.relative_to(dist).as_posix())
    (release / 'archive.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() +
                                          '  fieldlab-static.tar.gz\n', encoding='utf-8')
    print(f'Packaged {len(hashes)} static files and {len(changed)} source changes')


if __name__ == '__main__':
    main()
