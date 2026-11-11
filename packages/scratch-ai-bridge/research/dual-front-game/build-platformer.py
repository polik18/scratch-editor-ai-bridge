#!/usr/bin/env python3
"""Generate an offline Scratch platformer with a jumpable gap and a goal."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description='Generate a simple Scratch platformer')
parser.add_argument('--out', type=Path, default=Path(__file__).with_name('platformer.canonical.json'))
parser.add_argument('--speed', type=int, choices=range(4, 13), default=8, metavar='4..12')
parser.add_argument('--jump', type=int, choices=range(10, 19), default=14, metavar='10..18')
a = parser.parse_args()
def lit(value): return {'type': 'literal', 'value': value}
def var(name): return {'type':'variable', 'name':name}
def block(opcode, fields=None, **inputs):
    b={'opcode':opcode}
    if fields: b['fields']=fields
    if inputs: b['inputs']=inputs
    return b
def expr(opcode, **inputs): return {'type':'block','block':block(opcode,**inputs)}
def stack(blocks): return {'type':'stack','blocks':blocks}
def iff(condition, blocks): return block('control_if', CONDITION=condition, SUBSTACK=stack(blocks))
def lt(left,right): return expr('operator_lt',OPERAND1=left,OPERAND2=lit(right))
def gt(left,right): return expr('operator_gt',OPERAND1=left,OPERAND2=lit(right))
def both(left,right): return expr('operator_and',OPERAND1=left,OPERAND2=right)
def either(left,right): return expr('operator_or',OPERAND1=left,OPERAND2=right)
def eq(left,right): return expr('operator_equals',OPERAND1=left,OPERAND2=lit(right))
def setv(name,value): return block('data_setvariableto',{'VARIABLE':name},VALUE=lit(value))
def key(name): return block('event_whenkeypressed',{'KEY_OPTION':name})
def script(index,*blocks): return {'position':{'x':50+index*500,'y':50},'blocks':list(blocks)}
def x(): return expr('motion_xposition')
def y(): return expr('motion_yposition')
def active(): return eq(var('Game state'),'playing')
# Platform tops are at y=-115; the centre of the 50 px sprite rests at y=-90.
land=either(lt(x(),-29),gt(x(),59))
land_condition=both(both(land,lt(y(),-89)),lt(var('vertical speed'),1))
loop=[block('motion_changeyby',DY=var('vertical speed')),block('data_changevariableby',{'VARIABLE':'vertical speed'},VALUE=lit(-1)),iff(land_condition,[block('motion_sety',Y=lit(-90)),setv('vertical speed',0)]),iff(lt(y(),-165),[block('motion_gotoxy',X=lit(-180),Y=lit(-90)),setv('vertical speed',0),block('data_changevariableby',{'VARIABLE':'Falls'},VALUE=lit(1))]),iff(both(gt(x(),155),gt(y(),-100)),[setv('Game state','won')]),block('control_wait',DURATION=lit(0.03))]
player_svg='<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50" viewBox="0 0 40 50"><rect x="2" y="2" width="36" height="46" rx="10" fill="#36b8e8" stroke="#142f4a" stroke-width="3"/><circle cx="13" cy="19" r="4" fill="white"/><circle cx="27" cy="19" r="4" fill="white"/><path d="M13 31 Q20 37 27 31" stroke="#173b54" stroke-width="2" fill="none"/></svg>'
player={'kind':'sprite','name':'Player','variables':[{'name':'vertical speed','value':0}],'lists':[],'costumes':[{'name':'hero','dataFormat':'svg','data':player_svg,'rotationCenterX':20,'rotationCenterY':25}],'sounds':[],'scripts':[script(0,block('event_whenflagclicked'),block('motion_gotoxy',X=lit(-180),Y=lit(-90)),setv('vertical speed',0),block('control_forever',SUBSTACK=stack([iff(active(),loop)]))),script(1,key('left arrow'),iff(active(),[block('motion_changexby',DX=lit(-a.speed))])),script(2,key('right arrow'),iff(active(),[block('motion_changexby',DX=lit(a.speed))])),script(3,key('space'),iff(both(active(),both(land,eq(y(),-90))),[setv('vertical speed',a.jump)]))],'procedures':[],'x':-180,'y':-90,'direction':90,'size':100,'visible':True,'draggable':False,'rotationStyle':"don't rotate"}
scene='<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#c4eafc"/><circle cx="375" cy="70" r="32" fill="#ffe59a"/><path d="M0 295 H210 V360 H0 Z M300 295 H480 V360 H300 Z" fill="#388a5c"/><path d="M0 295 H210 M300 295 H480" stroke="#235d45" stroke-width="8"/><path d="M400 160 V295 M400 160 L450 175 L400 190" fill="#f27251" stroke="#78433a" stroke-width="5"/><text x="240" y="38" text-anchor="middle" fill="#173b54" font-size="22" font-family="sans-serif">SKY GAP</text><text x="240" y="60" text-anchor="middle" fill="#173b54" font-size="13" font-family="sans-serif">ARROWS: MOVE   SPACE: JUMP</text></svg>'
stage={'kind':'stage','name':'Stage','variables':[{'name':'Game state','value':'playing'},{'name':'Falls','value':0}], 'lists':[], 'costumes':[{'name':'sky gap','dataFormat':'svg','data':scene,'rotationCenterX':240,'rotationCenterY':180}], 'sounds':[], 'scripts':[script(0,block('event_whenflagclicked'),setv('Game state','playing'),setv('Falls',0))],'procedures':[]}
costumes=[]
for name,text in [('playing',''),('won','YOU WIN!')]:
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="220" height="50" viewBox="0 0 220 50"><text x="110" y="33" text-anchor="middle" fill="#173b54" font-family="sans-serif" font-size="28" font-weight="bold">{text}</text></svg>'
    costumes.append({'name':name,'dataFormat':'svg','data':svg,'rotationCenterX':110,'rotationCenterY':25})
result={'kind':'sprite','name':'Result','variables':[],'lists':[],'costumes':costumes,'sounds':[],'scripts':[script(0,block('event_whenflagclicked'),block('control_forever',SUBSTACK=stack([block('looks_switchcostumeto',COSTUME=var('Game state'))])))],'procedures':[],'x':0,'y':40,'direction':90,'size':100,'visible':True,'draggable':False,'rotationStyle':"don't rotate"}
project={'format':'scratch-ai-bridge/canonical-ir','version':1,'name':'Sky Gap','stage':stage,'sprites':[player,result],'broadcasts':[]}
a.out.write_text(json.dumps(project,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(a.out)
