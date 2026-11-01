#!/usr/bin/env python3
"""Create the deterministic Dual Front canonical project without external assets."""
import argparse
import json
import math
from costume_shapes import render, validate
from pathlib import Path

parser = argparse.ArgumentParser(description='Generate a two-player Scratch fighting project as Canonical IR.')
parser.add_argument('--out', type=Path, default=Path(__file__).with_name('dual-front-v2.canonical.json'))
parser.add_argument('--name', default='Dual Front Arena')
parser.add_argument('--damage', type=int, choices=(10, 20, 25, 50, 100), default=10)
parser.add_argument('--speed', type=int, choices=range(1, 31), default=12, metavar='1..30')
parser.add_argument('--reach', type=int, choices=range(10, 151), default=76, metavar='10..150')
parser.add_argument('--p1-spec', type=Path, help='Optional validated shape spec for player 1')
parser.add_argument('--p2-spec', type=Path, help='Optional validated shape spec for player 2')
parser.add_argument('--cooldown', type=float, default=0.35, metavar='0.1..3')
args = parser.parse_args()
if not math.isfinite(args.cooldown) or not 0.1 <= args.cooldown <= 3:
    parser.error('--cooldown must be between 0.1 and 3 seconds')
if not args.name.strip() or len(args.name) > 120:
    parser.error('--name must contain 1 to 120 non-whitespace characters')
OUT = args.out
specs = {}
for player, path in ((1, args.p1_spec), (2, args.p2_spec)):
    if path is not None:
        try:
            specs[player] = validate(json.loads(path.read_text(encoding='utf-8')))
            if len(specs[player]['shapes']) > 47:
                raise ValueError('at most 47 shapes are supported for a character pose')
        except (OSError, ValueError, TypeError) as error:
            parser.error(f'player {player} spec: {error}')
def lit(value): return {'type': 'literal', 'value': value}
def var(name): return {'type': 'variable', 'name': name}
def expr(opcode, **inputs): return {'type': 'block', 'block': block(opcode, **inputs)}
def stack(blocks): return {'type': 'stack', 'blocks': blocks}
def block(opcode, fields=None, **inputs):
    b = {'opcode': opcode}
    if fields: b['fields'] = fields
    if inputs: b['inputs'] = inputs
    return b
def key(k): return block('event_whenkeypressed', {'KEY_OPTION': k})
def setv(name, value): return block('data_setvariableto', {'VARIABLE': name}, VALUE=value)
def change(name, value): return block('data_changevariableby', {'VARIABLE': name}, VALUE=lit(value))
def eq(a, b): return expr('operator_equals', OPERAND1=a, OPERAND2=lit(b))
def less(a, b): return expr('operator_lt', OPERAND1=a, OPERAND2=lit(b))
def both(a,b): return expr('operator_and', OPERAND1=a, OPERAND2=b)
def iff(condition, blocks): return block('control_if', CONDITION=condition, SUBSTACK=stack(blocks))
def script(*blocks): return {'blocks': list(blocks)}
def costume(mode, player, attacking=False):
    light = mode == 'light'
    if player in specs:
        spec = json.loads(json.dumps(specs[player]))
        if not light:
            for shape in spec['shapes']:
                color = shape['fill']
                shape['fill'] = '#' + ''.join(f'{int(int(color[i:i+2], 16) * 0.6):02x}' for i in (1, 3, 5))
        if attacking:
            # A fixed extra fist preserves the generated base across animation poses.
            spec['shapes'].append({'type':'circle','cx':91,'cy':60,'r':7,'fill':'#e6c75e'})
        return {'name':mode + ('-attack' if attacking else ''), 'dataFormat':'svg', 'data':render(spec), 'rotationCenterX':50, 'rotationCenterY':55}
    base = ('#48b8ff' if light else '#6951ad') if player == 1 else ('#ffb052' if light else '#bb485c')
    trim = '#d5f4ff' if light else '#e4d5ff'
    arm = '<path d="M60 55 L91 47 L96 55 L66 65" fill="%s" stroke="#182342" stroke-width="3"/>' % base if attacking else '<path d="M60 55 L73 69 L65 77 L55 65" fill="%s" stroke="#182342" stroke-width="3"/>' % base
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="110" viewBox="0 0 100 110"><path d="M30 79 L24 103 H40 L47 81 M54 81 L61 103 H77 L68 79" fill="#263859" stroke="#111b30" stroke-width="3"/><path d="M31 49 Q50 38 69 49 L68 83 Q50 91 32 83 Z" fill="{base}" stroke="#182342" stroke-width="3"/><path d="M34 54 L22 73 L30 78 L43 62" fill="{base}" stroke="#182342" stroke-width="3"/>{arm}<circle cx="50" cy="29" r="22" fill="{base}" stroke="#182342" stroke-width="3"/><path d="M32 25 Q50 14 68 25 L65 35 Q50 40 35 35 Z" fill="{trim}"/><circle cx="43" cy="29" r="3" fill="#172341"/><circle cx="57" cy="29" r="3" fill="#172341"/><path d="M44 39 Q50 43 56 39" fill="none" stroke="#182342" stroke-width="2"/><path d="M44 54 L50 48 L56 54 L50 61 Z" fill="{trim}"/></svg>'
    return {'name': mode + ('-attack' if attacking else ''), 'dataFormat': 'svg', 'data': svg, 'rotationCenterX': 50, 'rotationCenterY': 55}
def make_sprite(n):
    other = 3-n
    name, opponent = f'Player {n}', f'Player {other}'
    health = f'P{other} health'
    mode, lock = f'P{n} mode', f'P{n} attack lock'
    left, right, switch, attack = (('a','d','q','f') if n==1 else ('left arrow','right arrow','up arrow','down arrow'))
    active = lambda: eq(var('Game state'), 'playing')
    switch_costume = block('looks_switchcostumeto', COSTUME=var(mode))
    attack_pose = block('looks_switchcostumeto', COSTUME=expr('operator_join', STRING1=var(mode), STRING2=lit('-attack')))
    distance = expr('sensing_distanceto', DISTANCETOMENU=lit(opponent))
    hit = [change(health,-args.damage), iff(less(var(health),1), [setv(health,lit(0)), setv('Game state',lit(f'P{n} wins'))])]
    face = block('motion_pointtowards', TOWARDS=lit(opponent))
    attack_blocks = [setv(lock,lit(1)), face, attack_pose, iff(less(distance,args.reach),hit), block('control_wait', DURATION=lit(args.cooldown)), switch_costume, setv(lock,lit(0))]
    scripts = [script(block('event_whenflagclicked'),block('motion_gotoxy',X=lit(-130 if n==1 else 130),Y=lit(-75)),setv(mode,lit('light')),setv(lock,lit(0)),face,switch_costume),
        script(key(left),iff(active(),[block('motion_changexby', DX=lit(-args.speed)), face])),
        script(key(right),iff(active(),[block('motion_changexby', DX=lit(args.speed)), face])),
        script(key(switch),iff(active(),[block('control_if_else',CONDITION=eq(var(mode),'light'),SUBSTACK=stack([setv(mode,lit('dark'))]),SUBSTACK2=stack([setv(mode,lit('light'))])),switch_costume])),
        script(key(attack),iff(both(active(),eq(var(lock),0)),attack_blocks))]
    return {'kind':'sprite','name':name,'variables':[{'name':mode,'value':'light'},{'name':lock,'value':0}], 'lists':[], 'costumes':[costume(m,n,a) for m in ('light','dark') for a in (False,True)], 'sounds':[], 'scripts':scripts,'procedures':[], 'x':-130 if n==1 else 130,'y':-75,'direction':90,'size':100,'visible':True,'draggable':False,'rotationStyle':'left-right'}
def hud_sprite(player):
    name = f'P{player} health'
    color = '#48b8ff' if player == 1 else '#ffb052'
    costumes = []
    for amount in range(0, 101, args.damage):
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="26" viewBox="0 0 160 26"><rect x="1" y="1" width="158" height="24" rx="6" fill="#15223c" stroke="#e1edff" stroke-width="2"/><rect x="4" y="4" width="{int(152 * amount / 100)}" height="18" rx="4" fill="{color}"/><text x="80" y="18" text-anchor="middle" fill="white" font-family="sans-serif" font-size="14">P{player}  {amount} / 100</text></svg>'
        costumes.append({'name': str(amount), 'dataFormat': 'svg', 'data': svg, 'rotationCenterX': 80, 'rotationCenterY': 13})
    checks = [iff(eq(var(name), amount), [block('looks_switchcostumeto', COSTUME=lit(str(amount)))]) for amount in range(0,101,args.damage)]
    return {'kind':'sprite','name':f'P{player} HUD','variables':[],'lists':[],'costumes':costumes,'sounds':[],'scripts':[script(block('event_whenflagclicked'), block('control_forever', SUBSTACK=stack(checks)))], 'procedures':[], 'x':-140 if player == 1 else 140,'y':65,'direction':90,'size':100,'visible':True,'draggable':False,'rotationStyle':"don't rotate"}
def status_sprite():
    costumes=[]
    for name, text in [('playing',''),('P1 wins','P1 WINS!'),('P2 wins','P2 WINS!')]:
        svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="180" height="50" viewBox="0 0 180 50"><text x="90" y="33" text-anchor="middle" fill="#ffffff" stroke="#182342" stroke-width="1" font-family="sans-serif" font-size="26" font-weight="bold">{text}</text></svg>'
        costumes.append({'name':name,'dataFormat':'svg','data':svg,'rotationCenterX':90,'rotationCenterY':25})
    return {'kind':'sprite','name':'Game result','variables':[],'lists':[],'costumes':costumes,'sounds':[],'scripts':[script(block('event_whenflagclicked'),block('control_forever',SUBSTACK=stack([block('looks_switchcostumeto',COSTUME=var('Game state'))])))], 'procedures':[],'x':0,'y':0,'direction':90,'size':100,'visible':True,'draggable':False,'rotationStyle':"don't rotate"}
backdrop='<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#111d36"/><circle cx="240" cy="105" r="75" fill="#273f6c"/><path d="M0 250 L480 250 L480 360 L0 360 Z" fill="#273750"/><path d="M0 250 H480 M0 290 H480 M120 250 L60 360 M240 250 V360 M360 250 L420 360" stroke="#6384ad" stroke-width="3"/><text x="240" y="48" text-anchor="middle" fill="#f4f6ff" font-size="24" font-family="sans-serif">DUAL FRONT</text><text x="240" y="76" text-anchor="middle" fill="#c5d5ed" font-size="12" font-family="sans-serif">P1: A D / Q / F    P2: arrows / up / down</text></svg>'
stage={'kind':'stage','name':'Stage','variables':[{'name':'P1 health','value':100},{'name':'P2 health','value':100},{'name':'Game state','value':'playing'}], 'lists':[], 'costumes':[{'name':'arena','dataFormat':'svg','data':backdrop,'rotationCenterX':240,'rotationCenterY':180}], 'sounds':[], 'scripts':[script(block('event_whenflagclicked'),setv('P1 health',lit(100)),setv('P2 health',lit(100)),setv('Game state',lit('playing')))],'procedures':[]}
monitors=[{'id':name,'opcode':'data_variable','params':{'VARIABLE':name},'spriteName':None,'mode':'default','value':value,'visible':False,'x':x,'y':y} for name,value,x,y in [('P1 health',100,8,8),('P2 health',100,340,8),('Game state','playing',180,45)]]
project={'format':'scratch-ai-bridge/canonical-ir','version':1,'name':args.name,'stage':stage,'sprites':[make_sprite(1),make_sprite(2),hud_sprite(1),hud_sprite(2),status_sprite()],'broadcasts':[],'monitors':monitors}
for target in [stage, *project['sprites']]:
    for index, item in enumerate(target['scripts']):
        item['position'] = {'x': 50 + index * 440, 'y': 50}
OUT.write_text(json.dumps(project,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(OUT)
