#!/usr/bin/env python3
"""Ask a local oMLX model for bounded shapes and render them as an offline SVG."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

parser = argparse.ArgumentParser(description='Create a Scratch SVG costume from a local oMLX shape description')
source = parser.add_mutually_exclusive_group(required=True)
source.add_argument('--description', help='Character description, sent only to local oMLX')
source.add_argument('--spec', type=Path, help='Use an existing bounded shape specification')
parser.add_argument('--out', type=Path, required=True, help='New SVG path; never overwritten')
parser.add_argument('--save-spec', type=Path, help='Optional new path for the generated shape specification')
parser.add_argument('--model', help='Optional oMLX model name; defaults to the locally configured model')
parser.add_argument('--use-local-settings', action='store_true', help='Read the local oMLX API token in memory from ~/.omlx/settings.json')
a = parser.parse_args()

from costume_shapes import SHAPES, render, validate

def generate(description):
    if not description.strip() or len(description) > 500:
        raise ValueError('description must contain 1 to 500 characters')
    token = os.environ.get('OMLX_API_KEY', '')
    if not token and a.use_local_settings:
        settings = json.loads((Path.home()/'.omlx/settings.json').read_text(encoding='utf-8'))
        token = settings.get('auth', {}).get('api_key', '')
    if not token:
        raise ValueError('local oMLX token is unavailable; set OMLX_API_KEY or use --use-local-settings')
    instruction = ('Return ONLY a JSON object with one key shapes, an array of 8 to 28 geometric shapes for a detailed, readable Scratch character. '
      'Canvas is 100 wide by 110 high, origin top left. Draw in back-to-front order. '
      'Allowed shapes: rect requires type,x,y,width,height,rx,fill; circle requires type,cx,cy,r,fill; '
      'ellipse requires type,cx,cy,rx,ry,fill. Every coordinate is a number 0..200. '
      'Every fill must be #RRGGBB. No text, paths, gradients, scripts, links, markdown, or extra keys. '
      'Use distinct colors and shapes for head, body, eyes, arms, feet and decorations. '
      'Example: {"shapes":[{"type":"circle","cx":50,"cy":30,"r":20,"fill":"#3366FF"},{"type":"rect","x":30,"y":50,"width":40,"height":40,"rx":5,"fill":"#3366FF"},{"type":"circle","cx":43,"cy":26,"r":3,"fill":"#FFFFFF"}]}')
    variants = []
    for kind, fields in SHAPES.items():
        properties = {key: {'type':'number', 'minimum':0, 'maximum':200} for key in fields}
        properties.update({'type': {'type':'string', 'enum':[kind]}, 'fill': {'type':'string', 'pattern':'^#[0-9a-fA-F]{6}$'}})
        variants.append({'type':'object','properties':properties,'required':list(properties),'additionalProperties':False})
    schema = {'type':'object','properties':{'shapes':{'type':'array','items':{'anyOf':variants},'minItems':3,'maxItems':28}},'required':['shapes'],'additionalProperties':False}
    model = a.model
    if not model:
        with urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5) as response:
            model = json.load(response).get('default_model')
    if not isinstance(model, str) or not model:
        raise ValueError('local oMLX has no default model; pass --model')
    payload = json.dumps({'model':model,'messages':[{'role':'system','content':instruction},{'role':'user','content':description}], 'temperature':0, 'max_tokens':2400, 'chat_template_kwargs':{'enable_thinking':False}, 'response_format':{'type':'json_schema','json_schema':{'name':'scratch_costume','schema':schema}}}).encode()
    req = urllib.request.Request('http://127.0.0.1:8000/v1/chat/completions', data=payload, headers={'Content-Type':'application/json','Authorization':'Bearer '+token}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            data=json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError(f'local oMLX request failed with HTTP {error.code}') from None
    text=data['choices'][0]['message']['content'].strip()
    if text.startswith('```'):
        text=re.sub(r'^```(?:json)?\s*|\s*```$', '', text, flags=re.I)
    return validate(json.loads(text))

try:
    spec=validate(json.loads(a.spec.read_text(encoding='utf-8'))) if a.spec else generate(a.description)
    svg=render(spec)
    if a.save_spec and a.save_spec.resolve() == a.out.resolve():
        raise ValueError('SVG and shape specification paths must be different')
    # Check both destinations before writing, then create exclusively.
    if a.out.exists() or (a.save_spec and a.save_spec.exists()):
        raise ValueError('output already exists; choose a new path')
    with a.out.open('x',encoding='utf-8') as f: f.write(svg)
    if a.save_spec:
        with a.save_spec.open('x',encoding='utf-8') as f: json.dump(spec,f,ensure_ascii=False,indent=2)
    print(f'Created {a.out} ({len(spec["shapes"])} shapes)')
except (OSError, ValueError, KeyError, IndexError, TypeError, urllib.error.URLError) as error:
    print(f'Costume generation failed: {error}', file=sys.stderr)
    sys.exit(1)
