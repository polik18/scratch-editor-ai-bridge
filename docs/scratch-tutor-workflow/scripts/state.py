#!/usr/bin/env python3
"""Small, single-writer checkpoint for the Scratch tutor plan; Python 3 stdlib."""
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
DEPS = {
    'T0a': [], 'T0b': ['T0a'], 'T0c': ['T0b'], 'T1a': ['T0c'], 'T1b': ['T1a'],
    'T2a': ['T1b'], 'T2b': ['T2a'], 'T2c': ['T2b'], 'T3a': ['T1b'], 'T3b': ['T3a'],
    'T4a': ['T2c', 'T3b'], 'T4b': ['T4a'], 'G0a': ['T0a'], 'G0b': ['G0a', 'T0b'],
    'G0c': ['G0a', 'T0b'], 'G0d': ['G0b', 'G0c'], 'G1a': ['T0a'], 'G1b': ['G1a'],
    'G2a': ['G0d', 'G1b'], 'G2b': ['G2a'],
}
OPTIONAL = {'T3b', 'G1b', 'G2a', 'G2b'}
FINISHED = {'done', 'skipped'}

def save(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=str(path.parent), prefix='.' + path.name + '.')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--path', type=Path, default=ROOT / 'state.json')
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('init', 'next', 'summary'):
        sub.add_parser(command)
    for command in ('start', 'retry', 'done', 'skip', 'block', 'uncertain'):
        p = sub.add_parser(command)
        p.add_argument('item', choices=DEPS)
        if command in ('done', 'skip'):
            p.add_argument('--evidence', required=True)
        if command in ('block', 'uncertain'):
            p.add_argument('--reason', required=True)
    a = parser.parse_args()
    path = a.path.expanduser().resolve()
    if a.command == 'init':
        if path.exists():
            raise ValueError('狀態檔已存在，禁止覆寫')
        state = {'schema': 1, 'workflow': 'scratch-tutor-20261105', 'items': {k: {'status': 'pending', 'evidence': None, 'reason': None, 'retries': 0} for k in DEPS}}
        save(path, state)
        print(json.dumps({'action': 'initialized', 'path': str(path)}, ensure_ascii=False))
        return
    state = json.loads(path.read_text(encoding='utf-8'))
    if state.get('schema') != 1 or set(state.get('items', {})) != set(DEPS):
        raise ValueError('狀態格式或項目清單不符')
    items = state['items']
    if a.command == 'summary':
        print(json.dumps(items, ensure_ascii=False, indent=2))
        return
    if a.command == 'next':
        for status, action in [('verify_pending', 'verify'), ('running', 'recover')]:
            for key, item in items.items():
                if item['status'] == status:
                    print(json.dumps({'action': action, 'item': key}, ensure_ascii=False))
                    return
        for key, deps in DEPS.items():
            if items[key]['status'] == 'pending' and all(items[d]['status'] in FINISHED for d in deps):
                print(json.dumps({'action': 'execute', 'item': key, 'card': str(ROOT / 'tasks' / (key + '.md'))}, ensure_ascii=False))
                return
        print(json.dumps({'action': 'none', 'message': '無就緒項；請檢查 blocked、failed 與依賴，不代表全案完成'}, ensure_ascii=False))
        return
    item = items[a.item]
    status = item['status']
    if a.command == 'start':
        if status != 'pending' or not all(items[d]['status'] in FINISHED for d in DEPS[a.item]):
            raise ValueError('項目不是 pending 或依賴未完成')
        if any(v['status'] in ('running', 'verify_pending') for v in items.values()):
            raise ValueError('已有工作進行中或待查證')
        item['status'] = 'running'
    elif a.command in ('done', 'skip'):
        if a.command == 'done' and status not in ('running', 'verify_pending'):
            raise ValueError('done 需為 running 或 verify_pending')
        if a.command == 'skip' and (a.item not in OPTIONAL or status != 'pending' or not all(items[d]['status'] in FINISHED for d in DEPS[a.item])):
            raise ValueError('只有依賴完成的指定可選 pending 項目可跳過')
        evidence = Path(a.evidence).expanduser()
        if not evidence.is_absolute() or not evidence.is_file() or evidence.stat().st_size == 0:
            raise ValueError('證據必須是非空的絕對檔案路徑')
        item.update(status='done' if a.command == 'done' else 'skipped', evidence=str(evidence.resolve()), reason=None)
    elif a.command in ('block', 'uncertain'):
        if status not in ('running', 'verify_pending'):
            raise ValueError('只有處理中或待查證項可設定此狀態')
        if not a.reason.strip():
            raise ValueError('原因不得為空')
        item.update(status='blocked' if a.command == 'block' else 'verify_pending', reason=a.reason)
    elif a.command == 'retry':
        if status not in ('blocked', 'verify_pending', 'running'):
            raise ValueError('只有中斷、待查證或受阻項可恢復')
        if item['retries'] >= 2:
            raise ValueError('已達重試上限，須人工檢視')
        item.update(status='pending', reason=None, retries=item['retries'] + 1)
    item['updated_at'] = datetime.now(timezone.utc).isoformat()
    save(path, state)
    print(json.dumps({'item': a.item, **item}, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as e:
        print('ERROR: ' + str(e), file=sys.stderr)
        sys.exit(1)
