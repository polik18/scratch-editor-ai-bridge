import json
L=lambda v:{'type':'literal','value':v}
V=lambda n:{'type':'variable','name':n}
B=lambda op,**kw:{'opcode':op,**({'inputs':kw} if kw else {})}
R=lambda op,**kw:{'type':'block','block':B(op,**kw)}
S=lambda *bs:{'type':'stack','blocks':list(bs)}
SET=lambda n,v:{'opcode':'data_setvariableto','fields':{'VARIABLE':n},'inputs':{'VALUE':v}}
CHANGE=lambda n,v:{'opcode':'data_changevariableby','fields':{'VARIABLE':n},'inputs':{'VALUE':L(v)}}
IF=lambda c,*bs:B('control_if',CONDITION=c,SUBSTACK=S(*bs))
LT=lambda a,b:R('operator_lt',OPERAND1=a,OPERAND2=b)
GT=lambda a,b:R('operator_gt',OPERAND1=a,OPERAND2=b)
AND=lambda a,b:R('operator_and',OPERAND1=a,OPERAND2=b)
OR=lambda a,b:R('operator_or',OPERAND1=a,OPERAND2=b)
MUL=lambda a,b:R('operator_multiply',NUM1=a,NUM2=b)
X=lambda:R('motion_xposition')
Y=lambda:R('motion_yposition')
KEY=lambda k:R('sensing_keypressed',KEY_OPTION=L(k))
MOVEX=lambda v:B('motion_changexby',DX=v)
MOVEY=lambda v:B('motion_changeyby',DY=v)
svg=lambda name,data,w,h:{'name':name,'dataFormat':'svg','data':data,'rotationCenterX':w/2,'rotationCenterY':h/2}
ballsvg='<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="#f8fafc" stroke="#38bdf8" stroke-width="3"/></svg>'
bumpsvg='<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="#f43f5e" stroke="#fda4af" stroke-width="5"/><circle cx="24" cy="24" r="9" fill="#fde68a"/></svg>'
padsvg='<svg xmlns="http://www.w3.org/2000/svg" width="76" height="16" viewBox="0 0 76 16"><rect x="2" y="2" width="72" height="12" rx="6" fill="#38bdf8" stroke="#f8fafc" stroke-width="3"/></svg>'
backsvg='<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" viewBox="0 0 480 360" fill="#0f172a"/><rect x="20" y="12" width="440" height="330" rx="24" fill="#172554" stroke="#38bdf8" stroke-width="5"/><text x="240" y="38" text-anchor="middle" font-family="sans-serif" font-size="18" fill="white">PINBALL - LEFT / RIGHT ARROWS</text></svg>'
ballloop=[MOVEX(V('vx')),MOVEY(V('vy')),CHANGE('vy',-0.15),IF(OR(LT(X(),L(-207)),GT(X(),L(207))),SET('vx',MUL(V('vx'),L(-1)))),IF(GT(Y(),L(147)),SET('vy',L(-4))),IF(AND(LT(Y(),L(-116)),AND(GT(X(),L(-120)),AND(LT(X(),L(0)),KEY('left arrow')))),SET('vy',L(8)),SET('vx',L(-3))),IF(AND(LT(Y(),L(-116)),AND(GT(X(),L(0)),AND(LT(X(),L(120)),KEY('right arrow')))),SET('vy',L(8)),SET('vx',L(3))),IF(LT(Y(),L(-165)),CHANGE('lives',-1),IF(LT(V('lives'),L(1)),B('looks_say',MESSAGE=L('Game over - click green flag')),{'opcode':'control_stop','fields':{'STOP_OPTION':'all'}}),B('motion_gotoxy',X=L(-160),Y=L(110)),SET('vy',L(-2))),B('control_wait',DURATION=L(.03))]
for n in ['Bumper1','Bumper2','Bumper3']:
 contact='contact '+n
 touching=lambda:R('sensing_touchingobject',TOUCHINGOBJECTMENU=L(n))
 ballloop.insert(-1,IF(AND(touching(),R('operator_equals',OPERAND1=V(contact),OPERAND2=L(0))),SET('vy',MUL(V('vy'),L(-1))),CHANGE('score',10),SET(contact,L(1))))
 ballloop.insert(-1,IF(R('operator_not',OPERAND=touching()),SET(contact,L(0))))
def sprite(name,costume,x,y,scripts=[]):return {'kind':'sprite','name':name,'variables':[],'lists':[],'costumes':[costume],'sounds':[],'scripts':scripts,'procedures':[],'x':x,'y':y,'direction':90,'size':100,'visible':True,'draggable':False,'rotationStyle':'all around'}
ball=sprite('Ball',svg('ball',ballsvg,22,22),-160,110,[{'blocks':[B('event_whenflagclicked'),B('motion_gotoxy',X=L(-160),Y=L(110)),{'opcode':'data_showvariable','fields':{'VARIABLE':'score'}},{'opcode':'data_showvariable','fields':{'VARIABLE':'lives'}},SET('vx',L(3)),SET('vy',L(-2)),*[SET('contact '+n,L(0)) for n in ['Bumper1','Bumper2','Bumper3']],SET('score',L(0)),SET('lives',L(3)),B('control_forever',SUBSTACK=S(*ballloop))]}])
ball['variables']=[{'name':'vx','value':0},{'name':'vy','value':0}]+[{'name':'contact '+n,'value':0} for n in ['Bumper1','Bumper2','Bumper3']]
stage={'kind':'stage','name':'Stage','variables':[{'name':'score','value':0},{'name':'lives','value':3}],'lists':[],'costumes':[svg('table',backsvg,480,360)],'sounds':[],'scripts':[],'procedures':[]}
sprites=[ball]+[sprite(n,svg('bumper',bumpsvg,48,48),x,y) for n,x,y in [('Bumper1',-100,60),('Bumper2',0,95),('Bumper3',100,60)]]+[sprite('LeftFlipper',svg('flipper',padsvg,76,16),-60,-135),sprite('RightFlipper',svg('flipper',padsvg,76,16),60,-135)]

for paddle,key,active in [(sprites[-2],'left arrow',60),(sprites[-1],'right arrow',120)]:
 paddle['scripts']=[{'blocks':[B('event_whenflagclicked'),B('control_forever',SUBSTACK=S(B('control_if_else',CONDITION=KEY(key),SUBSTACK=S(B('motion_pointindirection',DIRECTION=L(active))),SUBSTACK2=S(B('motion_pointindirection',DIRECTION=L(90))))))]}]
p={'format':'scratch-ai-bridge/canonical-ir','version':1,'name':'Pinball','stage':stage,'sprites':sprites,'broadcasts':[],'extensions':[],'monitors':[{'id':'score','opcode':'data_variable','params':{'VARIABLE':'score'},'spriteName':None,'mode':'default','value':0,'x':10,'y':10,'visible':True},{'id':'lives','opcode':'data_variable','params':{'VARIABLE':'lives'},'spriteName':None,'mode':'default','value':3,'x':10,'y':40,'visible':True}]}
json.dump(p,open('/tmp/pinball-refined.json','w'),ensure_ascii=False,indent=2)
