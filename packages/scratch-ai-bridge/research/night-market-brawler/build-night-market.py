#!/usr/bin/env python3
"""Night Market Mayhem: single-player street-fighter Canonical IR generator.

Single-player arcade brawler: player vs AI vendor-opponents across 4 escalating
waves, with a special-move "food power" meter, jump, HUD, and night-market
theme. Extends the deterministic Dual Front fighting template.

Usage:
  python3 build-night-market.py [--out path.json] [--name str]
"""
import argparse
import json
from pathlib import Path

GROUND_Y = -70
STAGE_W, STAGE_H = 480, 360

parser = argparse.ArgumentParser(description='Generate Night Market Mayhem as Canonical IR.')
parser.add_argument('--out', type=Path, default=Path(__file__).with_name('canonical.json'))
parser.add_argument('--name', default='Night Market Mayhem')
args = parser.parse_args()
if not args.name.strip() or len(args.name) > 120:
    parser.error('--name must contain 1 to 120 non-whitespace characters')
OUT = args.out

# --- Per-wave enemy template: (vendor name, health, speed, damage, reach) -----
WAVES = [
    ('臭豆腐大叔', 60, 2.0, 8, 50),
    ('蚵煎阿伯', 80, 2.5, 10, 50),
    ('珍珠奶茶姐', 100, 3.0, 12, 55),
    ('终极美食大帝', 150, 3.5, 15, 60),
]
MAX_WAVE = len(WAVES)
PLAYER_HP = 100
PLAYER_SPEED = 4.0
PLAYER_REACH = 55
PLAYER_DMG = 12
PLAYER_COOLDOWN = 0.30
SPECIAL_DMG = 35
SPECIAL_REACH = 70
SPECIAL_COST = 60
JUMP_POWER = 14.0
GRAVITY = -1.0
ENEMY_COOLDOWN = 0.5

# --- SVG helpers -------------------------------------------------------------
def svg_char(body, trim, hat, accent, extra=''):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="110" viewBox="0 0 100 110">'
        f'<path d="M38 82 L32 104 H44 L47 84 M52 84 L56 104 H68 L62 82" fill="#3a4a66" stroke="#141b30" stroke-width="3"/>'
        f'<path d="M33 50 Q50 40 67 50 L66 82 Q50 89 34 82 Z" fill="{body}" stroke="#182342" stroke-width="3"/>'
        f'<path d="M36 54 L24 70 L31 75 L44 60" fill="{body}" stroke="#182342" stroke-width="3"/>'
        f'<path d="M60 52 L74 58 L70 66 L57 60" fill="{accent}" stroke="#182342" stroke-width="3"/>'
        f'<circle cx="50" cy="38" r="20" fill="{trim}" stroke="#182342" stroke-width="3"/>'
        f'<circle cx="43" cy="37" r="3" fill="#172341"/><circle cx="57" cy="37" r="3" fill="#172341"/>'
        f'<path d="M44 45 L50 42 L56 45 L50 49 Z" fill="{accent}"/>'
        f'{extra}</svg>'
    )


def char_costumes(body, trim, hat, accent, extra=''):
    atk = '<path d="M60 55 L92 52 L96 60 L64 66" fill="#f4c542" stroke="#182342" stroke-width="3"/>'
    out = [{'name': 'v1', 'dataFormat': 'svg',
            'data': svg_char(body, trim, hat, accent, extra),
            'rotationCenterX': 50, 'rotationCenterY': 55}]
    for nm in ('v2', 'v3', 'v4'):
        out.append({'name': nm, 'dataFormat': 'svg',
                    'data': svg_char(body, trim, hat, accent, extra),
                    'rotationCenterX': 50, 'rotationCenterY': 55})
    out.append({'name': 'atk', 'dataFormat': 'svg',
                'data': svg_char(body, trim, hat, accent, atk),
                'rotationCenterX': 50, 'rotationCenterY': 55})
    return out


def bar_costume(i, color):  # i in 0..10
    w = int(150 * i / 10)
    return {'name': str(i), 'dataFormat': 'svg',
            'data': (f'<svg xmlns="http://www.w3.org/2000/svg" width="170" height="24" viewBox="0 0 170 24">'
                     f'<rect x="1" y="1" width="168" height="22" rx="6" fill="#10182e" stroke="#cfe0ff" stroke-width="2"/>'
                     f'<rect x="4" y="4" width="{w}" height="16" rx="4" fill="{color}"/></svg>'),
            'rotationCenterX': 85, 'rotationCenterY': 12}


def text_costume(line, w=260, h=40, fs=16, fill='#ffffff'):
    return {'name': 't', 'dataFormat': 'svg',
            'data': (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
                     f'<text x="{w//2}" y="26" text-anchor="middle" fill="{fill}" stroke="#182342" stroke-width="1.5" '
                     f'font-family="sans-serif" font-size="{fs}">{line}</text></svg>'),
            'rotationCenterX': w // 2, 'rotationCenterY': h // 2}


def banner_costume(text, color):
    return {'name': text, 'dataFormat': 'svg',
            'data': (f'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80">'
                     f'<rect x="10" y="10" width="300" height="60" rx="12" fill="{color}" stroke="#fff" stroke-width="4"/>'
                     f'<text x="160" y="50" text-anchor="middle" fill="#fff" stroke="#141b30" stroke-width="2" '
                     f'font-family="sans-serif" font-size="34" font-weight="bold">{text}</text></svg>'),
            'rotationCenterX': 160, 'rotationCenterY': 40}


# --- Canonical IR helpers ----------------------------------------------------
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
def value(v): return v if isinstance(v, dict) else lit(v)
def setv(name, v): return block('data_setvariableto', {'VARIABLE': name}, VALUE=value(v))
def change(name, v): return block('data_changevariableby', {'VARIABLE': name}, VALUE=value(v))
def eq(a, b): return expr('operator_equals', OPERAND1=value(a), OPERAND2=value(b))
def less(a, b): return expr('operator_lt', OPERAND1=value(a), OPERAND2=value(b))
def greater(a, b): return expr('operator_gt', OPERAND1=value(a), OPERAND2=value(b))
def both(a, b): return expr('operator_and', OPERAND1=value(a), OPERAND2=value(b))
def either(a, b): return expr('operator_or', OPERAND1=value(a), OPERAND2=value(b))
def not_(a): return expr('operator_not', OPERAND=a)
def iff(condition, blocks): return block('control_if', CONDITION=condition, SUBSTACK=stack(blocks))
def script(*blocks): return {'blocks': list(blocks)}
def broadcast(msg): return block('event_broadcast', BROADCAST_INPUT={'type': 'broadcast', 'name': msg})
def whenrecv(msg): return block('event_whenbroadcastreceived', {'BROADCAST_OPTION': msg})
def dist_to(sprite): return expr('sensing_distanceto', DISTANCETOMENU=lit(sprite))


# --- Gameplay ---------------------------------------------------------------
def active(): return eq(var('gameState'), 'playing')
def sub(a, b): return expr('operator_subtract', NUM1=value(a), NUM2=value(b))
def in_range(reach):
    delta = sub(var('playerX'), var('enemyX'))
    return both(less(delta, reach), greater(delta, sub(0, reach)))
def sprite(name, costumes, scripts, x=0, y=0, visible=True, variables=()):
    return {'kind': 'sprite', 'name': name, 'variables': [{'name': n, 'value': v} for n, v in variables],
            'lists': [], 'costumes': costumes, 'sounds': [], 'scripts': scripts, 'procedures': [],
            'x': x, 'y': y, 'direction': 90, 'size': 100, 'visible': visible,
            'draggable': False, 'rotationStyle': 'left-right'}

def player_sprite():
    costumes = char_costumes('#3fb8e8', '#e8f6ff', '#c8500f', '#f4c542')
    costumes.append({'name': 'spc', 'dataFormat': 'svg', 'data': svg_char('#ffd23f', '#fff2b0', '', '#f4c542'), 'rotationCenterX': 50, 'rotationCenterY': 55})
    scripts = [script(block('event_whenflagclicked'), block('motion_gotoxy', X=lit(-150), Y=lit(GROUND_Y)),
                      setv('pLock', 0), setv('pGround', 1), setv('pVy', 0), block('looks_show'),
                      block('looks_switchcostumeto', COSTUME=lit('v1')))]
    for k, dx in [('left arrow', -PLAYER_SPEED), ('a', -PLAYER_SPEED), ('right arrow', PLAYER_SPEED), ('d', PLAYER_SPEED)]:
        scripts.append(script(key(k), iff(active(), [block('motion_changexby', DX=lit(dx))])))
    for k in ('up arrow', 'w'):
        scripts.append(script(key(k), iff(both(active(), eq(var('pGround'), 1)), [setv('pVy', JUMP_POWER), setv('pGround', 0)])))
    for k, special in [('f', False), ('z', False), ('space', True), ('x', True)]:
        allowed = both(both(active(), eq(var('pLock'), 0)), eq(var('eVisible'), 1))
        if special: allowed = both(allowed, greater(var('superMeter'), 99))
        hit = [change('enemyHealth', -SPECIAL_DMG if special else -PLAYER_DMG),
               change('superMeter', 12 if special else 8),
               iff(greater(var('superMeter'), 100), [setv('superMeter', 100)]), broadcast('enemyHit')]
        action = [setv('pLock', 1)]
        if special: action.append(change('superMeter', -SPECIAL_COST))
        action += [block('motion_pointtowards', TOWARDS=lit('Enemy')),
                   block('looks_switchcostumeto', COSTUME=lit('spc' if special else 'atk')),
                   iff(in_range(SPECIAL_REACH if special else PLAYER_REACH), hit),
                   block('control_wait', DURATION=lit(PLAYER_COOLDOWN)),
                   block('looks_switchcostumeto', COSTUME=lit('v1')), setv('pLock', 0)]
        scripts.append(script(key(k), iff(allowed, action)))
    scripts.append(script(block('event_whenflagclicked'), block('control_forever', SUBSTACK=stack([
        setv('playerX', expr('motion_xposition')),
        iff(eq(var('pGround'), 0), [change('pVy', GRAVITY), block('motion_changeyby', DY=var('pVy')),
            iff(not_(greater(expr('motion_yposition'), GROUND_Y)), [block('motion_sety', Y=lit(GROUND_Y)), setv('pVy', 0), setv('pGround', 1)])])]))))
    scripts.append(script(whenrecv('playerHit'), block('looks_changeeffectby', {'EFFECT': 'ghost'}, CHANGE=lit(50)),
                          block('control_wait', DURATION=lit(0.08)), block('looks_changeeffectby', {'EFFECT': 'ghost'}, CHANGE=lit(-50))))
    return sprite('Player', costumes, scripts, -150, GROUND_Y, variables=[('pLock', 0), ('pGround', 1), ('pVy', 0)])

def enemy_sprite():
    colors = ['#e8603a', '#a6a347', '#b057a5', '#deac35']
    costumes = []
    for i, color in enumerate(colors):
        costumes.append({'name': f'v{i+1}', 'dataFormat': 'svg', 'data': svg_char(color, '#ffe0c0', '', '#f4c542'), 'rotationCenterX': 50, 'rotationCenterY': 55})
    scripts = [script(block('event_whenflagclicked'), block('motion_gotoxy', X=lit(150), Y=lit(GROUND_Y)),
                      setv('eLock', 0), block('looks_show')),
               script(whenrecv('readyEnemy'), block('motion_gotoxy', X=lit(150), Y=lit(GROUND_Y)),
                      setv('enemyX', 150), setv('eLock', 0), block('looks_switchcostumeto', COSTUME=var('enemyCostume')), block('looks_show'))]
    approach = block('control_if_else', CONDITION=less(var('enemyX'), var('playerX')),
                     SUBSTACK=stack([block('motion_changexby', DX=var('enemySpeed'))]),
                     SUBSTACK2=stack([block('motion_changexby', DX=sub(0, var('enemySpeed')))]))
    attack = [setv('eLock', 1), change('playerHealth', sub(0, var('enemyDamage'))), broadcast('playerHit'),
              iff(less(var('playerHealth'), 1), [setv('playerHealth', 0), setv('gameState', 'gameOver')]),
              block('control_wait', DURATION=lit(ENEMY_COOLDOWN)), setv('eLock', 0)]
    scripts.append(script(block('event_whenflagclicked'), block('control_forever', SUBSTACK=stack([
        setv('enemyX', expr('motion_xposition')),
        iff(both(active(), eq(var('eVisible'), 1)), [block('motion_pointtowards', TOWARDS=lit('Player')),
            block('control_if_else', CONDITION=in_range(var('enemyReach')),
                  SUBSTACK=stack([iff(eq(var('eLock'), 0), attack)]), SUBSTACK2=stack([approach]))])]))))
    recoil = block('control_if_else', CONDITION=less(var('enemyX'), var('playerX')),
                   SUBSTACK=stack([block('motion_changexby', DX=lit(-12))]), SUBSTACK2=stack([block('motion_changexby', DX=lit(12))]))
    scripts.append(script(whenrecv('enemyHit'),
        iff(both(active(), eq(var('eVisible'), 1)), [recoil,
            block('looks_changeeffectby', {'EFFECT': 'ghost'}, CHANGE=lit(50)),
            iff(less(var('enemyHealth'), 1), [setv('enemyHealth', 0), setv('eVisible', 0), block('looks_hide'), broadcast('enemyDefeated')]),
            block('control_wait', DURATION=lit(0.08)), block('looks_changeeffectby', {'EFFECT': 'ghost'}, CHANGE=lit(-50))])))
    return sprite('Enemy', costumes, scripts, 150, GROUND_Y, variables=[('eLock', 0)])

def hud_bar(var_name, color, x, y, denominator):
    costumes = [bar_costume(i, color) for i in range(11)]
    for i, costume in enumerate(costumes): costume['name'] = f'bar{i}'
    pct = expr('operator_round', NUM=expr('operator_divide',
        NUM1=expr('operator_multiply', NUM1=var(var_name), NUM2=lit(10)), NUM2=value(denominator)))
    name = expr('operator_join', STRING1=lit('bar'), STRING2=pct)
    return sprite('HUD ' + var_name, costumes, [script(block('event_whenflagclicked'),
        block('control_forever', SUBSTACK=stack([block('looks_switchcostumeto', COSTUME=name)])))], x, y)

def hud_wave_sprite():
    costumes = [text_costume(f'第 {i+1} 波  {wave[0]}') for i, wave in enumerate(WAVES)]
    for i, costume in enumerate(costumes): costume['name'] = f'wave{i+1}'
    name = expr('operator_join', STRING1=lit('wave'), STRING2=var('wave'))
    return sprite('HUD Wave', costumes, [script(block('event_whenflagclicked'),
        block('control_forever', SUBSTACK=stack([block('looks_switchcostumeto', COSTUME=name)])))], 0, 105)

def result_sprite():
    costumes = [banner_costume(text, color) for text, color in [('playing', '#1a1230'), ('playerWins', '#2e8b57'), ('gameOver', '#b22222')]]
    costumes[0]['data'] = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
    costumes[1]['data'] = costumes[1]['data'].replace('playerWins', 'YOU WIN!')
    costumes[2]['data'] = costumes[2]['data'].replace('gameOver', 'GAME OVER')
    return sprite('Result', costumes, [script(block('event_whenflagclicked'),
        block('control_forever', SUBSTACK=stack([block('looks_switchcostumeto', COSTUME=var('gameState'))])))])

def hittext_sprite():
    return sprite('HitText', [text_costume('HIT!', w=120, h=50, fs=26, fill='#ffe066')],
        [script(block('event_whenflagclicked'), block('looks_hide')),
         script(whenrecv('enemyHit'), block('looks_show'), block('control_wait', DURATION=lit(0.12)), block('looks_hide'))], 0, 30, False)


# --- Stage + director --------------------------------------------------------
def stage_sprite():
    backdrop = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">'
        '<rect width="480" height="360" fill="#1a1230"/>'
        '<circle cx="90" cy="70" r="26" fill="#e23a3a" stroke="#ffb052" stroke-width="3"/>'
        '<rect x="84" y="96" width="12" height="20" fill="#e23a3a"/>'
        '<circle cx="390" cy="55" r="26" fill="#e23a3a" stroke="#ffb052" stroke-width="3"/>'
        '<rect x="384" y="81" width="12" height="20" fill="#e23a3a"/>'
        '<path d="M0 250 L480 250 L480 360 L0 360 Z" fill="#2a1c44"/>'
        '<path d="M20 190 L60 190 L64 250 L16 250 Z" fill="#3a2c55" stroke="#ffb052" stroke-width="2"/>'
        '<path d="M150 190 L210 190 L214 250 L146 250 Z" fill="#3a2c55" stroke="#ffb052" stroke-width="2"/>'
        '<path d="M300 190 L360 190 L364 250 L296 250 Z" fill="#3a2c55" stroke="#ffb052" stroke-width="2"/>'
        '<path d="M0 185 H480" stroke="#ffb052" stroke-width="2" opacity="0.5"/>'
        '<text x="240" y="140" text-anchor="middle" fill="#ffd23f" font-size="40" font-family="sans-serif" font-weight="bold">夜市狂戰夜</text>'
        '<text x="240" y="168" text-anchor="middle" fill="#e8d5ff" font-size="13" font-family="sans-serif">NIGHT MARKET BRAWLER</text>'
        '</svg>')
    return {'kind': 'stage', 'name': 'Stage', 'variables': [
        {'name': 'playerHealth', 'value': PLAYER_HP},
        {'name': 'enemyHealth', 'value': WAVES[0][1]},
        {'name': 'eVisible', 'value': 1}, {'name': 'playerX', 'value': -150}, {'name': 'enemyX', 'value': 150},
        {'name': 'enemyMaxHealth', 'value': WAVES[0][1]},
        {'name': 'superMeter', 'value': 0},
        {'name': 'wave', 'value': 1},
        {'name': 'gameState', 'value': 'playing'},
        {'name': 'enemyCostume', 'value': 'v1'},
        {'name': 'enemySpeed', 'value': WAVES[0][2]},
        {'name': 'enemyDamage', 'value': WAVES[0][3]},
        {'name': 'enemyReach', 'value': WAVES[0][4]}], 'lists': [],
        'costumes': [{'name': 'arena', 'dataFormat': 'svg', 'data': backdrop,
                      'rotationCenterX': 240, 'rotationCenterY': 180}], 'sounds': [],
        'scripts': [script(block('event_whenflagclicked'),
            setv('playerHealth', lit(PLAYER_HP)), setv('enemyHealth', lit(WAVES[0][1])),
            setv('enemyMaxHealth', lit(WAVES[0][1])), setv('superMeter', lit(0)), setv('wave', lit(1)),
            setv('gameState', lit('playing')), setv('enemyCostume', lit('v1')),
            setv('enemySpeed', lit(WAVES[0][2])), setv('enemyDamage', lit(WAVES[0][3])),
            setv('enemyReach', lit(WAVES[0][4])), setv('eVisible', 1), setv('playerX', -150), setv('enemyX', 150))], 'procedures': []}


def director_sprite():
    # A single handler snapshots the defeated wave before changing it.
    choices = [setv('gameState', 'playerWins')]
    for k in reversed(range(1, MAX_WAVE)):
        nxt = WAVES[k]
        advance = [setv('wave', k + 1), setv('enemyHealth', nxt[1]), setv('enemyMaxHealth', nxt[1]),
                   setv('enemySpeed', nxt[2]), setv('enemyDamage', nxt[3]), setv('enemyReach', nxt[4]),
                   setv('enemyCostume', f'v{k+1}'), block('control_wait', DURATION=lit(0.35)),
                   setv('eVisible', 1), broadcast('readyEnemy')]
        choices = [block('control_if_else', CONDITION=eq(var('wave'), k), SUBSTACK=stack(advance), SUBSTACK2=stack(choices))]
    return sprite('Director', [text_costume('')], [script(whenrecv('enemyDefeated'), iff(active(), choices))], visible=False)


# --- Assemble ----------------------------------------------------------------
def build():
    stage = stage_sprite()
    director = director_sprite()
    sprites = [player_sprite(), enemy_sprite(),
               hud_bar('playerHealth', '#3fb8e8', -145, 145, 100),
               hud_bar('enemyHealth', '#ff7043', 145, 145, var('enemyMaxHealth')),
               hud_bar('superMeter', '#ffd23f', 0, -140, 100),
               hud_wave_sprite(), result_sprite(), hittext_sprite(), director]
    project = {'format': 'scratch-ai-bridge/canonical-ir', 'version': 1, 'name': args.name,
               'stage': stage, 'sprites': sprites, 'broadcasts': [{'name': n} for n in ('enemyHit', 'playerHit', 'enemyDefeated', 'readyEnemy')], 'monitors': []}
    for target in [stage, *project['sprites']]:
        for index, item in enumerate(target['scripts']):
            item['position'] = {'x': 50 + index * 440, 'y': 50}
    OUT.write_text(json.dumps(project, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(OUT)


if __name__ == '__main__':
    build()
