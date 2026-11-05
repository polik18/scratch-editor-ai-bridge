#!/usr/bin/env python3
"""
Generate教学 fixture for Scratch AI Bridge.
生成 Scratch AI Bridge 的教學測試案例。
"""

import json
import os
import uuid
import zipfile
from datetime import datetime

FIXTURES_DIR = "/Users/huangjianzhe/Git/scratch-editor-ai-bridge/docs/scratch-tutor-workflow/fixtures"
os.makedirs(FIXTURES_DIR, exist_ok=True)

# Blank SVG for default costume
BLANK_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
<rect width="100" height="100" fill="none"/>
</svg>'''

# Simple silent WAV data (valid but minimal)
SILENT_WAV = bytes([
    0x52, 0x49, 0x46, 0x46,  # RIFF
    0x2C, 0x00, 0x00, 0x00,  # Chunk size
    0x57, 0x41, 0x56, 0x45,  # WAVE
    0x66, 0x6D, 0x74, 0x20,  # fmt
    0x10, 0x00, 0x00, 0x00,  # Format chunk size
    0x01, 0x00,              # Audio format (1 = PCM)
    0x01, 0x00,              # Channels
    0x44, 0xAC, 0x00, 0x00,  # Sample rate (44100)
    0x88, 0x58, 0x01, 0x00,  # Byte rate (44100 * 2)
    0x02, 0x00,              # Block align (2)
    0x10, 0x00,              # Bits per sample (16)
    0x64, 0x61, 0x74, 0x61,  # data
    0x00, 0x00, 0x00, 0x00,  # Size (0 samples = silent)
])


def create_project_json(name="Untitled", targets=None, extensions=None):
    """Create a minimal Scratch project.json structure."""
    return {
        "targets": targets or [],
        "monitors": [],
        "extensions": extensions or [],
        "meta": {
            "semver": "3.0.0",
            "vm": "0.2.0",
            "agent": "user",
            "date": datetime.now().isoformat(),
            "exporter": "fixture-generator",
            "projectType": "project"
        }
    }


def create_target(name="Sprite1", is_stage=False, variables=None, lists=None, broadcasts=None, blocks=None, costumes=None, sounds=None):
    """Create a target (sprite or stage)."""
    target_id = str(uuid.uuid4()).replace("-", "")[:24]
    
    if is_stage:
        target_id = " Stage1"[:24].ljust(24, "0")
    
    return {
        "isStage": is_stage,
        "name": name,
        "variableIds": {k: v for k, v in (variables or {}).items()},
        "listIds": {k: v for k, v in (lists or {}).items()},
        "broadcastIds": {k: v for k, v in (broadcasts or {}).items()},
        "blocks": blocks or {},
        "costumes": costumes or [],
        "sounds": sounds or [],
        "volume": 100,
        "layerOrder": 0,
        "tempo": 60,
        "videoTransparency": 50,
        "videoState": "on",
        "textToSpeechLanguage": None,
        "mouseWheelScroll": False,
        "scrollbars": False,
        "stageSize": {"width": 480, "height": 360},
        "presentationMode": False,
        "hideStagingArea": False,
        "codeEditorType": "scratch",
        "currentCostume": 0,
        "zOrder": 0
    }


def add_green_flag_block(blocks, block_id=None):
    """Add a green flag event block."""
    if block_id is None:
        block_id = str(uuid.uuid4()).replace("-", "")[:24]
    
    blocks[block_id] = {
        "opcode": "event_whenflagclicked",
        "next": None,
        "parent": None,
        "inputs": {},
        "fields": {},
        "shadow": False,
        "topLevel": True,
        "x": 10,
        "y": 10
    }
    return block_id


def add_when_key_pressed_block(blocks, key="space", next_block=None, block_id=None):
    """Add a when key pressed event block."""
    if block_id is None:
        block_id = str(uuid.uuid4()).replace("-", "")[:24]
    
    blocks[block_id] = {
        "opcode": "event_whenkeypressed",
        "next": next_block,
        "parent": None,
        "inputs": {
            "KEY_OPTION": [1, key]
        },
        "fields": {
            "KEY_OPTION": [key, None]
        },
        "shadow": False,
        "topLevel": True,
        "x": 10,
        "y": 50
    }
    return block_id


def add_collision_scoring_block(blocks, block_id=None):
    """Add collision detection and scoring logic."""
    if block_id is None:
        block_id = str(uuid.uuid4()).replace("-", "")[:24]
    
    # Variable for score
    score_var_id = str(uuid.uuid4()).replace("-", "")[:24]
    
    # When flag clicked
    flag_block_id = str(uuid.uuid4()).replace("-", "")[:24]
    blocks[flag_block_id] = {
        "opcode": "event_whenflagclicked",
        "next": "setScore0",
        "parent": None,
        "inputs": {},
        "fields": {},
        "shadow": False,
        "topLevel": True,
        "x": 10,
        "y": 10
    }
    
    # Set score to 0
    blocks["setScore0"] = {
        "opcode": "data_setvariableto",
        "next": "collisionCheck",
        "parent": flag_block_id,
        "inputs": {
            "VALUE": [1, ["reporter0"]]
        },
        "fields": {
            "VARIABLE": ["score", score_var_id]
        },
        "shadow": False,
        "topLevel": False,
        "x": 10,
        "y": 90
    }
    
    # Reporter block (for 0)
    blocks["reporter0"] = {
        "opcode": "math_number",
        "next": None,
        "parent": "setScore0",
        "inputs": {},
        "fields": {
            "NUM": 0
        },
        "shadow": True,
        "topLevel": False,
        "x": 0,
        "y": 0
    }
    
    # Collision check loop
    blocks["collisionCheck"] = {
        "opcode": "control_forever",
        "next": None,
        "parent": "setScore0",
        "inputs": {
            "SUBSTACK": [2, ["touchCheck0"]]
        },
        "fields": {},
        "shadow": False,
        "topLevel": False,
        "x": 10,
        "y": 130
    }
    
    # Touch check
    blocks["touchCheck0"] = {
        "opcode": "control_if",
        "next": None,
        "parent": "collisionCheck",
        "inputs": {
            "SUBSTACK": [2, ["ifTrueBlock0"]],
            "SUBSTACK2": [2, []]
        },
        "fields": {},
        "shadow": False,
        "topLevel": False,
        "x": 10,
        "y": 170
    }
    
    # Touching sprite1?
    blocks["touchingCheck0"] = {
        "opcode": "sensing_touchingobject",
        "next": None,
        "parent": "touchCheck0",
        "inputs": {
            "TOUCHINGOBJECTMENU": [1, "Sprite1"]
        },
        "fields": {
            "TOUCHINGOBJECTMENU": ["Sprite1", None]
        },
        "shadow": False,
        "topLevel": False,
        "x": 10,
        "y": 210
    }
    
    # Increase score
    blocks["ifTrueBlock0"] = {
        "opcode": "data_changevariableby",
        "next": None,
        "parent": "touchCheck0",
        "inputs": {
            "VALUE": [1, " reporter1"]
        },
        "fields": {
            "VARIABLE": ["score", score_var_id]
        },
        "shadow": False,
        "topLevel": False,
        "x": 10,
        "y": 250
    }
    
    return blocks, score_var_id


def add_loop_ifelse_blocks(blocks, block_id=None):
    """Add loop and if-else blocks."""
    if block_id is None:
        block_id = str(uuid.uuid4()).replace("-", "")[:24]
    
    # For loop
    for_block_id = str(uuid.uuid4()).replace("-", "")[:24]
    blocks[for_block_id] = {
        "opcode": "controls_repeat_ext",
        "next": None,
        "parent": None,
        "inputs": {
            "TIMES": [1, "4"],
            "SUBSTACK": [2, "moveStep"]
        },
        "fields": {},
        "shadow": False,
        "topLevel": True,
        "x": 10,
        "y": 10
    }
    
    # Move step
    blocks["moveStep"] = {
        "opcode": "motion_movesteps",
        "next": None,
        "parent": for_block_id,
        "inputs": {
            "STEPS": [1, "10"]
        },
        "fields": {},
        "shadow": False,
        "topLevel": False,
        "x": 10,
        "y": 50
    }
    
    # If-else
    if_block_id = str(uuid.uuid4()).replace("-", "")[:24]
    blocks[if_block_id] = {
        "opcode": "control_if_else",
        "next": None,
        "parent": None,
        "inputs": {
            "SUBSTACK": [2, "ifTrueBlock"],
            "SUBSTACK2": [2, "ifFalseBlock"]
        },
        "fields": {},
        "shadow": False,
        "topLevel": True,
        "x": 10,
        "y": 100
    }
    
    # If condition
    blocks["ifCondition"] = {
        "opcode": "logic_compare",
        "next": None,
        "parent": if_block_id,
        "inputs": {
            "OP": [1, "EQ"],
            "NUM1": [1, "1"],
            "NUM2": [1, "2"]
        },
        "fields": {
            "OP": ["EQ", None]
        },
        "shadow": False,
        "topLevel": False,
        "x": 10,
        "y": 140
    }
    
    # If true block
    blocks["ifTrueBlock"] = {
        "opcode": "motion_movesteps",
        "next": None,
        "parent": if_block_id,
        "inputs": {
            "STEPS": [1, "20"]
        },
        "fields": {},
        "shadow": False,
        "topLevel": False,
        "x": 10,
        "y": 180
    }
    
    # If false block
    blocks["ifFalseBlock"] = {
        "opcode": "motion_movesteps",
        "next": None,
        "parent": if_block_id,
        "inputs": {
            "STEPS": [1, "-20"]
        },
        "fields": {},
        "shadow": False,
        "topLevel": False,
        "x": 10,
        "y": 220
    }
    
    return blocks


def add_nested_operations_blocks(blocks, block_id=None):
    """Add nested operations."""
    if block_id is None:
        block_id = str(uuid.uuid4()).replace("-", "")[:24]
    
    # Nested math operation: (1 + 2) * 3
    nested_block_id = str(uuid.uuid4()).replace("-", "")[:24]
    blocks[nested_block_id] = {
        "opcode": "operator_multiply",
        "next": None,
        "parent": None,
        "inputs": {
            "NUM1": [1, "addBlock"],
            "NUM2": [1, "3"]
        },
        "fields": {},
        "shadow": False,
        "topLevel": True,
        "x": 10,
        "y": 10
    }
    
    # Add block: 1 + 2
    blocks["addBlock"] = {
        "opcode": "operator_add",
        "next": None,
        "parent": nested_block_id,
        "inputs": {
            "NUM1": [1, "1"],
            "NUM2": [1, "2"]
        },
        "fields": {},
        "shadow": False,
        "topLevel": False,
        "x": 10,
        "y": 50
    }
    
    return blocks


def add_broadcast_blocks(blocks, block_id=None):
    """Add broadcast and message blocks."""
    if block_id is None:
        block_id = str(uuid.uuid4()).replace("-", "")[:24]
    
    msg_id = str(uuid.uuid4()).replace("-", "")[:24]
    
    # Broadcast
    blocks[block_id] = {
        "opcode": "event_broadcast",
        "next": None,
        "parent": None,
        "inputs": {
            "BROADCAST_INPUT": [1, ["msg1", msg_id]]
        },
        "fields": {
            "BROADCAST_INPUT": ["msg1", msg_id]
        },
        "shadow": False,
        "topLevel": True,
        "x": 10,
        "y": 10
    }
    
    # Wait for message
    wait_block_id = str(uuid.uuid4()).replace("-", "")[:24]
    blocks[wait_block_id] = {
        "opcode": "event_whenbroadcastreceived",
        "next": "receiveAction",
        "parent": None,
        "inputs": {
            "BROADCAST_OPTION": [1, ["msg1", msg_id]]
        },
        "fields": {
            "BROADCAST_OPTION": ["msg1", msg_id]
        },
        "shadow": False,
        "topLevel": True,
        "x": 10,
        "y": 50
    }
    
    # Receive action
    blocks["receiveAction"] = {
        "opcode": "motion_movesteps",
        "next": None,
        "parent": wait_block_id,
        "inputs": {
            "STEPS": [1, "50"]
        },
        "fields": {},
        "shadow": False,
        "topLevel": False,
        "x": 10,
        "y": 90
    }
    
    return blocks, msg_id


def add_custom_block_parameters(blocks, block_id=None):
    """Add custom block with parameters."""
    if block_id is None:
        block_id = str(uuid.uuid4()).replace("-", "")[:24]
    
    # Create custom block definition (in a real project, this would be in a separate block)
    # For fixture purposes, we'll create a call to a custom block
    block_def_id = str(uuid.uuid4()).replace("-", "")[:24]
    proc_def = f"procDef{block_def_id}"
    
    # Call to custom block
    blocks[block_id] = {
        "opcode": "procedures_call",
        "next": None,
        "parent": None,
        "inputs": {},
        "fields": {
            "PROCCODE": [proc_def, None]
        },
        "shadow": False,
        "topLevel": True,
        "x": 10,
        "y": 10
    }
    
    return blocks


def add_unknown_extension_blocks(blocks, block_id=None):
    """Add blocks from unknown/unsupported extension."""
    if block_id is None:
        block_id = str(uuid.uuid4()).replace("-", "")[:24]
    
    # Add extension
    extensions = ["unknown_ext"]
    
    # Block from unknown extension
    blocks[block_id] = {
        "opcode": "unknown_ext_something",
        "next": None,
        "parent": None,
        "inputs": {},
        "fields": {},
        "shadow": False,
        "topLevel": True,
        "x": 10,
        "y": 10
    }
    
    return blocks, extensions


def add_missing_evidence_blocks(blocks, block_id=None):
    """Add blocks with missing evidence (no comments, no labels)."""
    if block_id is None:
        block_id = str(uuid.uuid4()).replace("-", "")[:24]
    
    # Simple movement with no documentation
    blocks[block_id] = {
        "opcode": "motion_movesteps",
        "next": "moveMore",
        "parent": None,
        "inputs": {
            "STEPS": [1, "20"]
        },
        "fields": {},
        "shadow": False,
        "topLevel": True,
        "x": 10,
        "y": 10
    }
    
    blocks["moveMore"] = {
        "opcode": "motion_turnright",
        "next": None,
        "parent": block_id,
        "inputs": {
            "DEGREES": [1, "15"]
        },
        "fields": {},
        "shadow": False,
        "topLevel": False,
        "x": 10,
        "y": 50
    }
    
    return blocks


def add_duplicate_name_blocks(blocks, block_id=None):
    """Add sprites with duplicate names."""
    # Create two sprites with the same name
    target1 = create_target(name="Sprite", is_stage=False)
    target2 = create_target(name="Sprite", is_stage=False)
    
    # Add different blocks to each
    target1["blocks"] = {
        "block1": {
            "opcode": "event_whenflagclicked",
            "next": "move1",
            "parent": None,
            "inputs": {},
            "fields": {},
            "shadow": False,
            "topLevel": True,
            "x": 10,
            "y": 10
        },
        "move1": {
            "opcode": "motion_movesteps",
            "next": None,
            "parent": "block1",
            "inputs": {
                "STEPS": [1, "10"]
            },
            "fields": {},
            "shadow": False,
            "topLevel": False,
            "x": 10,
            "y": 50
        }
    }
    
    target2["blocks"] = {
        "block2": {
            "opcode": "event_whenflagclicked",
            "next": "move2",
            "parent": None,
            "inputs": {},
            "fields": {},
            "shadow": False,
            "topLevel": True,
            "x": 10,
            "y": 100
        },
        "move2": {
            "opcode": "motion_movesteps",
            "next": None,
            "parent": "block2",
            "inputs": {
                "STEPS": [1, "20"]
            },
            "fields": {},
            "shadow": False,
            "topLevel": False,
            "x": 10,
            "y": 150
        }
    }
    
    return [target1, target2]


def create_large_project():
    """Create a large project with many blocks."""
    targets = []
    
    # Stage
    stage = create_target(name="Stage", is_stage=True)
    stage_blocks = {}
    add_green_flag_block(stage_blocks)
    stage["blocks"] = stage_blocks
    targets.append(stage)
    
    # Multiple sprites with many blocks each
    for i in range(5):
        sprite = create_target(name=f"Sprite{i+1}", is_stage=False)
        sprite_blocks = {}
        
        # Add multiple blocks per sprite
        flag_id = add_green_flag_block(sprite_blocks)
        
        # Repeat loop
        repeat_id = str(uuid.uuid4()).replace("-", "")[:24]
        sprite_blocks[flag_id] = {
            "opcode": "event_whenflagclicked",
            "next": repeat_id,
            "parent": None,
            "inputs": {},
            "fields": {},
            "shadow": False,
            "topLevel": True,
            "x": 10,
            "y": 10
        }
        
        sprite_blocks[repeat_id] = {
            "opcode": "controls_repeat_ext",
            "next": None,
            "parent": flag_id,
            "inputs": {
                "TIMES": [1, "10"],
                "SUBSTACK": [2, f"moveBlock{i}"]
            },
            "fields": {},
            "shadow": False,
            "topLevel": False,
            "x": 10,
            "y": 50
        }
        
        sprite_blocks[f"moveBlock{i}"] = {
            "opcode": "motion_movesteps",
            "next": None,
            "parent": repeat_id,
            "inputs": {
                "STEPS": [1, "10"]
            },
            "fields": {},
            "shadow": False,
            "topLevel": False,
            "x": 10,
            "y": 90
        }
        
        sprite["blocks"] = sprite_blocks
        targets.append(sprite)
    
    return targets


def save_sb3(filename, project_json, assets=None):
    """Save project as SB3 file."""
    filepath = os.path.join(FIXTURES_DIR, filename)
    
    with zipfile.ZipFile(filepath, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Add project.json
        zf.writestr("project.json", json.dumps(project_json, indent=2))
        
        # Add assets if provided
        if assets:
            for asset_name, asset_data in assets.items():
                zf.writestr(asset_name, asset_data)
    
    print(f"Created: {filepath} ({os.path.getsize(filepath)} bytes)")
    return filepath


def main():
    """Generate all test fixtures."""
    print("Generating Scratch test fixtures...\n")
    
    # T0b-1: Green Flag
    print("1. Creating green flag fixture...")
    p1 = create_project_json(name="GreenFlag")
    t1 = create_target(name="Sprite1")
    blocks1 = {}
    add_green_flag_block(blocks1)
    t1["blocks"] = blocks1
    p1["targets"] = [t1]
    save_sb3("green-flag.sb3", p1)
    
    # T0b-2: When Key Pressed
    print("2. Creating key pressed fixture...")
    p2 = create_project_json(name="KeyPressed")
    t2 = create_target(name="Sprite1")
    blocks2 = {}
    add_when_key_pressed_block(blocks2, key="space")
    t2["blocks"] = blocks2
    p2["targets"] = [t2]
    save_sb3("key-pressed.sb3", p2, {"83a9787d4cb6f3b7632b4ddfebf74367.wav": SILENT_WAV})
    
    # T0b-3: Collision Scoring
    print("3. Creating collision scoring fixture...")
    p3 = create_project_json(name="CollisionScoring")
    t3 = create_target(name="Sprite1")
    blocks3, score_var = add_collision_scoring_block({})
    t3["blocks"] = blocks3
    t3["variableIds"] = {"score": score_var}
    p3["targets"] = [t3]
    save_sb3("collision-scoring.sb3", p3)
    
    # T0b-4: Loop and If-Else
    print("4. Creating loop and if-else fixture...")
    p4 = create_project_json(name="LoopIfElse")
    t4 = create_target(name="Sprite1")
    blocks4 = add_loop_ifelse_blocks({})
    t4["blocks"] = blocks4
    p4["targets"] = [t4]
    save_sb3("loop-ifelse.sb3", p4)
    
    # T0b-5: Nested Operations
    print("5. Creating nested operations fixture...")
    p5 = create_project_json(name="NestedOps")
    t5 = create_target(name="Sprite1")
    blocks5 = add_nested_operations_blocks({})
    t5["blocks"] = blocks5
    p5["targets"] = [t5]
    save_sb3("nested-ops.sb3", p5)
    
    # T0b-6: Broadcast
    print("6. Creating broadcast fixture...")
    p6 = create_project_json(name="Broadcast")
    t6 = create_target(name="Sprite1")
    blocks6, msg_id = add_broadcast_blocks({})
    t6["blocks"] = blocks6
    t6["broadcastIds"] = {"msg1": msg_id}
    p6["targets"] = [t6]
    save_sb3("broadcast.sb3", p6)
    
    # T0b-7: Custom Block Parameters
    print("7. Creating custom block parameters fixture...")
    p7 = create_project_json(name="CustomBlock")
    t7 = create_target(name="Sprite1")
    blocks7 = add_custom_block_parameters({})
    t7["blocks"] = blocks7
    p7["targets"] = [t7]
    save_sb3("custom-block.sb3", p7)
    
    # T0b-8: Unknown Extension
    print("8. Creating unknown extension fixture...")
    p8 = create_project_json(name="UnknownExt", extensions=["unknown_ext"])
    t8 = create_target(name="Sprite1")
    blocks8, ext_list = add_unknown_extension_blocks({})
    t8["blocks"] = blocks8
    p8["targets"] = [t8]
    save_sb3("unknown-ext.sb3", p8)
    
    # T0b-9: Missing Evidence
    print("9. Creating missing evidence fixture...")
    p9 = create_project_json(name="MissingEvidence")
    t9 = create_target(name="Sprite1")
    blocks9 = add_missing_evidence_blocks({})
    t9["blocks"] = blocks9
    p9["targets"] = [t9]
    save_sb3("missing-evidence.sb3", p9)
    
    # T0b-10: Duplicate Name
    print("10. Creating duplicate name fixture...")
    p10 = create_project_json(name="DuplicateName")
    targets10 = add_duplicate_name_blocks({})
    p10["targets"] = targets10
    save_sb3("duplicate-name.sb3", p10)
    
    # T0b-11: Large Project
    print("11. Creating large project fixture...")
    p11 = create_project_json(name="LargeProject")
    targets11 = create_large_project()
    p11["targets"] = targets11
    save_sb3("large-project.sb3", p11)
    
    print("\nAll fixtures created successfully!")
    print(f"Fixtures location: {FIXTURES_DIR}")


if __name__ == "__main__":
    main()
