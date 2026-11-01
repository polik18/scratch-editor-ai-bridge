"""Validate and render a small, offline-safe Scratch vector shape vocabulary."""
import math
import re
from xml.sax.saxutils import escape

COLORS = re.compile(r'^#[0-9a-fA-F]{6}$')
SHAPES = {
    'rect': ('x', 'y', 'width', 'height', 'rx'),
    'circle': ('cx', 'cy', 'r'),
    'ellipse': ('cx', 'cy', 'rx', 'ry'),
}

def validate(raw):
    if not isinstance(raw, dict) or set(raw) != {'shapes'} or not isinstance(raw['shapes'], list):
        raise ValueError('spec must contain only a shapes array')
    if not 3 <= len(raw['shapes']) <= 48:
        raise ValueError('spec must contain 3 to 48 shapes')
    for index, shape in enumerate(raw['shapes']):
        if not isinstance(shape, dict) or shape.get('type') not in SHAPES:
            raise ValueError(f'shape {index} has an unsupported type')
        required = set(SHAPES[shape['type']]) | {'type', 'fill'}
        if set(shape) != required:
            raise ValueError(f'shape {index} must contain exactly {sorted(required)}')
        if not isinstance(shape['fill'], str) or not COLORS.fullmatch(shape['fill']):
            raise ValueError(f'shape {index} fill must be a six-digit hex color')
        for key in SHAPES[shape['type']]:
            value = shape[key]
            if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not 0 <= value <= 200:
                raise ValueError(f'shape {index} {key} must be a finite number from 0 to 200')
    return raw

def render(spec):
    pieces = []
    for shape in validate(spec)['shapes']:
        attrs = ' '.join(f'{key}="{escape(str(shape[key]))}"' for key in SHAPES[shape['type']])
        pieces.append(f'<{shape["type"]} {attrs} fill="{shape["fill"]}"/>')
    return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="110" viewBox="0 0 100 110">' + ''.join(pieces) + '</svg>\n'

