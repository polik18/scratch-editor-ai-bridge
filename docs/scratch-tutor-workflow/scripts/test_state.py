#!/usr/bin/env python3
"""Exercise recovery and dependency rules with a disposable checkpoint."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

script = Path(__file__).with_name('state.py')
with tempfile.TemporaryDirectory() as tmp:
    state = Path(tmp) / 'state.json'
    evidence = Path(tmp) / 'evidence.md'
    evidence.write_text('Independent verification record.\n', encoding='utf-8')
    def run(*args, ok=True):
        result = subprocess.run([sys.executable, str(script), '--path', str(state), *args], capture_output=True, text=True)
        assert (result.returncode == 0) == ok, (args, result.stdout, result.stderr)
        return json.loads(result.stdout) if result.returncode == 0 else None
    run('init')
    run('init', ok=False)
    assert run('next')['item'] == 'T0a'
    run('start', 'T0b', ok=False)
    run('start', 'T0a')
    assert run('next') == {'action': 'recover', 'item': 'T0a'}
    run('start', 'G0a', ok=False)
    run('uncertain', 'T0a', '--reason', 'outcome unknown')
    assert run('next') == {'action': 'verify', 'item': 'T0a'}
    run('done', 'T0a', '--evidence', str(Path(tmp) / 'missing'), ok=False)
    run('done', 'T0a', '--evidence', str(evidence))
    assert run('next')['item'] == 'T0b'
    run('skip', 'T0b', '--evidence', str(evidence), ok=False)
    run('start', 'T0b')
    run('block', 'T0b', '--reason', 'temporary')
    assert run('next')['item'] == 'G0a'
    run('retry', 'T0b')
    assert run('next')['item'] == 'T0b'
    run('start', 'G1a')
    run('done', 'G1a', '--evidence', str(evidence))
    run('skip', 'G1b', '--evidence', str(evidence))
    assert run('summary')['G1b']['status'] == 'skipped'
    print('PASS: initialization, dependencies, interrupted recovery, verification priority, evidence, skip, block and retry')
