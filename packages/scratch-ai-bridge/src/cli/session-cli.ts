/**
 * scratch-session CLI entry point.
 *
 * Usage (run via tsx):
 *   npx tsx src/cli/session-cli.ts new [name]
 *   npx tsx src/cli/session-cli.ts load <file.sb3>
 *   npx tsx src/cli/session-cli.ts save [file.sb3]
 *   npx tsx src/cli/session-cli.ts info
 *   npx tsx src/cli/session-cli.ts inspect
 *   npx tsx src/cli/session-cli.ts plan --patch=<patch.json>
 *   npx tsx src/cli/session-cli.ts apply --patch=<patch.json> --out=<output.sb3>
 *   npx tsx src/cli/session-cli.ts undo
 *   npx tsx src/cli/session-cli.ts diff
 *   npx tsx src/cli/session-cli.ts ls
 *   npx tsx src/cli/session-cli.ts add-sprite <name> [--x N] [--y N] [--direction N] [--visible] [--draggable]
 *   npx tsx src/cli/session-cli.ts rm-sprite <name>
 *   npx tsx src/cli/session-cli.ts rename <oldName> <newName>
 *   npx tsx src/cli/session-cli.ts add-block <target> <opcode> [--field KEY VAL] [--input KEY BLOCKID SHADOWID] [--parent ID] [--next ID]
 *   npx tsx src/cli/session-cli.ts rm-block <target> <blockId>
 *   npx tsx src/cli/session-cli.ts edit-block <target> <blockId> [--field KEY VAL] [--input KEY BLOCKID SHADOWID] [--parent ID] [--next ID]
 *   npx tsx src/cli/session-cli.ts add-var <target> <name> [value]
 *   npx tsx src/cli/session-cli.ts add-list <target> <name> [value...]
 *   npx tsx src/cli/session-cli.ts attach <target> <hatOpcode> <bodyBlockId>
 *   npx tsx src/cli/session-cli.ts compile [output.sb3]
 *   npx tsx src/cli/session-cli.ts preview [output.png]
 *   npx tsx src/cli/session-cli.ts open [--url http://localhost:8601]
 *
 * Session state is persisted in a .scratch-session.json sidecar file so
 * subsequent commands within the same project directory automatically resume
 * the last session. Each command loads the project from the file at the start
 * and saves it back at the end.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ScratchSession, type AddSpriteOptions } from './session/session.js';
import { generateGameFromDesign } from './game-cli.js';

// ─── Session state file ──────────────────────────────────────────────────────

const SESSION_FILE = '.scratch-session.json';

interface SavedSession {
  format: 'scratch-session';
  version: 1;
  projectPath: string | null;
  lastModified: string;
  projectJson?: Record<string, unknown>;
}

function sessionFilePath(): string {
  return path.join(process.cwd(), SESSION_FILE);
}

function writeSessionFile(projectPath: string | null, projectJson?: Record<string, unknown>): void {
  const state: SavedSession = { format: 'scratch-session', version: 1, projectPath, lastModified: new Date().toISOString(), ...(projectJson ? { projectJson } : {}) };
  const temporary = `${sessionFilePath()}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, sessionFilePath());
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/** Restore an explicit sidecar; old sidecars are read and migrated on the next write. */
async function loadSession(): Promise<ScratchSession> {
  const file = sessionFilePath();
  if (!fs.existsSync(file)) throw new Error(`Session not found: ${file}. Run scratch-session new or load <file.sb3>.`);
  let meta: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected an object');
    meta = parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Cannot read session ${file}: ${error instanceof Error ? error.message : String(error)}. Restore the file or start a new session.`);
  }
  if (meta.format !== undefined && (meta.format !== 'scratch-session' || meta.version !== 1)) throw new Error('Unsupported session format or version.');
  const sess = new ScratchSession();
  if (typeof meta.projectPath === 'string' && meta.projectPath) {
    const projectPath = path.resolve(process.cwd(), meta.projectPath);
    if (!fs.existsSync(projectPath)) throw new Error(`Session project not found: ${projectPath}. Restore it or run load <file.sb3>.`);
    await sess.loadSb3(projectPath);
    return sess;
  }
  const projectJson = meta.projectJson ?? (Array.isArray(meta.targets) ? meta : undefined);
  if (!projectJson || typeof projectJson !== 'object' || Array.isArray(projectJson) || !Array.isArray((projectJson as Record<string, unknown>).targets)) {
    throw new Error('Session has no valid project data. Restore it or run new/load.');
  }
  sess.loadProjectJson(projectJson as Record<string, unknown>);
  return sess;
}

async function saveSession(sess: ScratchSession, outputPath?: string): Promise<void> {
  const resolved = outputPath ?? sess.info().path;
  if (resolved) {
    const saved = await sess.saveSb3(resolved);
    writeSessionFile(saved);
  } else {
    writeSessionFile(null, sess.getProjectJson());
  }
}

const requireOptionValue = (args: string[], index: number, option: string): string => {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value. See scratch-session --help.`);
  return value;
};

// ─── Command dispatch ────────────────────────────────────────────────────────

type CommandHandler = (argv: string[]) => Promise<void> | void;

const commands: Record<string, CommandHandler> = {
  // ── Lifecycle ────────────────────────────────────────────────────────────

  async new(argv) {
    const name = argv[0] ?? 'Untitled';
    const sess = new ScratchSession();
    sess.newProject(name);
    await saveSession(sess);
    console.log(`✓ New project "${name}" created.`);
    console.log(`  Session state saved to ${sessionFilePath()}`);
  },

  async newGame(argv) {
    const designArg = argv.find(a => a.startsWith('--design='));
    if (!designArg) {
      throw new Error('Usage: new-game --design=<design-file.json> [--output=<dir>]');
    }
    const designPath = designArg.replace('--design=', '');
    
    const outputArg = argv.find(a => a.startsWith('--output='));
    const outputDir = outputArg ? outputArg.replace('--output=', '.') : '.';
    
    const outputPath = await generateGameFromDesign(designPath, outputDir);
    console.log(`✓ Game created: ${outputPath}`);
  },

  async ['new-game'](argv) {
    await commands.newGame(argv);
  },

  async load(argv) {
    if (!argv[0]) throw new Error('Usage: load <file.sb3>');
    const filePath = path.resolve(argv[0]);
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    const sess = new ScratchSession();
    await sess.loadSb3(filePath);
    writeSessionFile(filePath);
    const info = sess.info();
    console.log(`✓ Loaded "${filePath}" (${info.targetCount} targets: ${info.targets.join(', ')})`);
  },

  async save(argv) {
    const outputPath = argv[0] ?? undefined;
    const sess = await loadSession();
    const info = sess.info();
    
    if (info.path || outputPath) {
      // Loaded project or explicit output: save to .sb3
      const saved = await sess.saveSb3(outputPath);
      writeSessionFile(saved);
      console.log(`✓ Saved to "${saved}"`);
    } else {
      // New project without output path: only save sidecar
      await saveSession(sess);
      console.log(`✓ Sidecar saved to "${sessionFilePath()}"`);
    }
  },

  // ── Info ─────────────────────────────────────────────────────────────────

  async info() {
    const sess = await loadSession();
    const info = sess.info();
    console.log(`Project:   ${info.path ?? '(unsaved new project)'}`);
    console.log(`Dirty:     ${info.isDirty}`);
    console.log(`Targets:   ${info.targetCount} (${info.targets.join(', ')})`);
  },

  async plan(argv) {
    const sess = await loadSession();
    const patchArg = argv.find(a => a.startsWith('--patch='));
    const patchPath = patchArg ? patchArg.replace('--patch=', '') : null;
    if (!patchPath) {
      console.error('Error: --patch=<path> required');
      process.exit(1);
    }
    const patch = JSON.parse(await fs.promises.readFile(patchPath, 'utf-8'));
    const result = sess.plan(patch);
    console.log(JSON.stringify(result, null, 2));
  },

  async apply(argv) {
    const sess = await loadSession();
    const patchArg = argv.find(a => a.startsWith('--patch='));
    const outputPathArg = argv.find(a => a.startsWith('--out='));
    const patchPath = patchArg ? patchArg.replace('--patch=', '') : null;
    const outputPath = outputPathArg ? outputPathArg.replace('--out=', '') : null;
    if (!patchPath || !outputPath) {
      console.error('Error: --patch=<path> and --out=<path> required');
      process.exit(1);
    }
    const patch = JSON.parse(await fs.promises.readFile(patchPath, 'utf-8'));
    const result = await sess.apply(patch, outputPath);
    console.log(JSON.stringify(result, null, 2));
  },

  async undo() {
    const sess = await loadSession();
    const result = sess.undo();
    console.log(JSON.stringify(result, null, 2));
  },

  async diff() {
    const sess = await loadSession();
    const result = sess.diff();
    console.log(JSON.stringify(result, null, 2));
  },
  async inspect() {
    const sess = await loadSession();
    const result = sess.inspect();
    console.log(JSON.stringify(result, null, 2));
  },

  async ls() {
    const sess = await loadSession();
    const targets = sess.listTargets();
    for (const t of targets) {
      const summary = sess.inspect().targets.find((s) => s.name === t)!;
      const marker = summary.isStage ? '[Stage]' : '[Sprite]';
      console.log(`  ${marker} ${t}`);
      console.log(`           blocks=${summary.blockCount} vars=${summary.variableCount} lists=${summary.listCount}`);
    }
  },

  // ── Sprite management ────────────────────────────────────────────────────

  async ['add-sprite'](argv) {
    if (!argv[0]) throw new Error('Usage: add-sprite <name> [--x N] [--y N] [--direction N] [--visible] [--draggable] [--size N]');
    const name = argv[0];
    const opts: AddSpriteOptions = {};
    const rest = argv.slice(1);
    for (let i = 0; i < rest.length; i++) {
      switch (rest[i]) {
        case '--x': opts.x = Number(rest[++i]); break;
        case '--y': opts.y = Number(rest[++i]); break;
        case '--direction': opts.direction = Number(rest[++i]); break;
        case '--visible': opts.visible = true; break;
        case '--draggable': opts.draggable = true; break;
        case '--size': opts.size = Number(rest[++i]); break;
      }
    }
    const sess = await loadSession();
    const id = sess.addSprite(name, opts);
    await saveSession(sess);
    console.log(`✓ Added sprite "${name}" (id=${id})`);
  },

  async ['rm-sprite'](argv) {
    if (!argv[0]) throw new Error('Usage: rm-sprite <name>');
    const sess = await loadSession();
    sess.removeSprite(argv[0]);
    await saveSession(sess);
    console.log(`✓ Removed sprite "${argv[0]}"`);
  },

  async rename(argv) {
    if (!argv[0] || !argv[1]) throw new Error('Usage: rename <currentName> <newName>');
    const sess = await loadSession();
    sess.renameTarget(argv[0], argv[1]);
    await saveSession(sess);
    console.log(`✓ Renamed "${argv[0]}" → "${argv[1]}"`);
  },

  // ── Block management ─────────────────────────────────────────────────────

  async ['add-block'](argv) {
    // add-block <target> <opcode> [--field KEY VAL] [--input KEY BLOCKID SHADOWID] [--parent ID] [--next ID]
    if (!argv[0] || !argv[1]) throw new Error('Usage: add-block <target> <opcode> [--field KEY VAL] [--input KEY BLOCKID SHADOWID] [--parent ID] [--next ID]');
    const [target, opcode] = argv;
    const fields: Record<string, [string, string | null]> = {};
    const inputs: Record<string, { block: string; shadow: string }> = {};
    let parent: string | null = null;
    let next: string | null = null;

    const rest = argv.slice(2);
    for (let i = 0; i < rest.length; i++) {
      switch (rest[i]) {
        case '--field': {
          const k = requireOptionValue(rest, ++i, '--field');
          const v = requireOptionValue(rest, ++i, '--field');
          fields[k] = [v, null];
          break;
        }
        case '--input': {
          const k = requireOptionValue(rest, ++i, '--input');
          const blockId = requireOptionValue(rest, ++i, '--input');
          const shadowId = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : blockId;
          inputs[k] = { block: blockId, shadow: shadowId };
          break;
        }
        case '--parent': parent = requireOptionValue(rest, ++i, '--parent'); break;
        case '--next': next = requireOptionValue(rest, ++i, '--next'); break;
        default: throw new Error(`Unknown block option: ${rest[i]}. See scratch-session --help.`);
      }
    }

    const sess = await loadSession();
    const newId = sess.addBlock(target, opcode, { fields, inputs, parent, next });
    await saveSession(sess);
    console.log(`✓ Added block ${opcode} on "${target}" (id=${newId})`);
  },

  async ['rm-block'](argv) {
    if (!argv[0] || !argv[1]) throw new Error('Usage: rm-block <target> <blockId>');
    const [target, blockId] = argv;
    const sess = await loadSession();
    sess.removeBlock(target, blockId);
    await saveSession(sess);
    console.log(`✓ Removed block "${blockId}" from "${target}"`);
  },

  async ['edit-block'](argv) {
    // edit-block <target> <blockId> [--field KEY VAL] [--input KEY BLOCKID SHADOWID] [--parent ID] [--next ID]
    if (!argv[0] || !argv[1]) throw new Error('Usage: edit-block <target> <blockId> [--field KEY VAL] [--input KEY BLOCKID SHADOWID] [--parent ID] [--next ID]');
    const [target, blockId] = argv;
    const fields: Record<string, [string, string | null]> = {};
    const inputs: Record<string, { block: string; shadow: string }> = {};
    let parent: string | undefined;
    let next: string | undefined;

    const rest = argv.slice(2);
    for (let i = 0; i < rest.length; i++) {
      switch (rest[i]) {
        case '--field': {
          const k = requireOptionValue(rest, ++i, '--field');
          const v = requireOptionValue(rest, ++i, '--field');
          fields[k] = [v, null];
          break;
        }
        case '--input': {
          const k = requireOptionValue(rest, ++i, '--input');
          const blockId2 = requireOptionValue(rest, ++i, '--input');
          const shadowId = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : blockId2;
          inputs[k] = { block: blockId2, shadow: shadowId };
          break;
        }
        case '--parent': parent = requireOptionValue(rest, ++i, '--parent'); break;
        case '--next': next = requireOptionValue(rest, ++i, '--next'); break;
        default: throw new Error(`Unknown block option: ${rest[i]}. See scratch-session --help.`);
      }
    }

    const sess = await loadSession();
    sess.editBlock(target, blockId, {
      fields: Object.keys(fields).length ? fields : undefined,
      inputs: Object.keys(inputs).length ? inputs : undefined,
      ...(parent !== undefined ? { parent } : {}),
      ...(next !== undefined ? { next } : {}),
    });
    await saveSession(sess);
    console.log(`✓ Edited block "${blockId}" on "${target}"`);
  },

  // ── Variable / List ──────────────────────────────────────────────────────

  async ['add-var'](argv) {
    if (!argv[0] || !argv[1]) throw new Error('Usage: add-var <target> <name> [initialValue]');
    const [target, name, rawValue] = argv;
    const value = rawValue !== undefined ? (isNaN(Number(rawValue)) ? rawValue : Number(rawValue)) : 0;
    const sess = await loadSession();
    const id = sess.addVariable(target, name, value as number | string);
    await saveSession(sess);
    console.log(`✓ Added variable "${name}" on "${target}" (id=${id})`);
  },

  async ['add-list'](argv) {
    if (!argv[0] || !argv[1]) throw new Error('Usage: add-list <target> <name> [initialValue...]');
    const [target, name, ...values] = argv;
    const sess = await loadSession();
    const parsed = values.map((v) => (isNaN(Number(v)) ? v : Number(v)));
    const id = sess.addList(target, name, parsed);
    await saveSession(sess);
    console.log(`✓ Added list "${name}" on "${target}" (id=${id})`);
  },

  // ── Hat wiring ───────────────────────────────────────────────────────────

  async attach(argv) {
    // attach <target> <hatOpcode> <bodyBlockId>
    if (!argv[0] || !argv[1] || !argv[2]) throw new Error('Usage: attach <target> <hatOpcode> <bodyBlockId>');
    const [target, hatOpcode, bodyBlockId] = argv;
    const sess = await loadSession();
    sess.attachBlockToHat(target, hatOpcode, bodyBlockId);
    await saveSession(sess);
    console.log(`✓ Attached block "${bodyBlockId}" to hat "${hatOpcode}" on "${target}"`);
  },

  // ── Compile ──────────────────────────────────────────────────────────────

  async compile(argv) {
    const outputPath = argv?.[0];
    const sess = await loadSession();
    
    const archive = await sess.compile();

    if (outputPath) {
      await fs.promises.writeFile(outputPath, archive);
      console.log(`✓ Compiled and saved to "${path.resolve(outputPath)}"`);
      console.log('✓ Archive, block graph and Scratch VM load checks passed.');
    } else {
      const info = sess.info();
      const defaultPath = (info.path ?? 'output').replace(/\.sb3$/i, '') + '.compiled.sb3';
      await fs.promises.writeFile(defaultPath, archive);
      console.log(`✓ Compiled to "${defaultPath}" (${(archive.byteLength / 1024).toFixed(1)} KB)`);
      console.log('✓ Archive, block graph and Scratch VM load checks passed.');
    }
  },
  // ── Preview ──────────────────────────────────────────────────────────────

  async preview(argv) {
    const sess = await loadSession();
    const archive = await sess.compile();
    const { captureRendererPreview } = await import('./renderer-preview.js');
    const outputPath = argv[0] ?? 'preview.png';
    const result = await captureRendererPreview(archive, outputPath);
    console.log(`✓ Scratch stage screenshot saved to "${result.path}" (${result.width}x${result.height}).`);
  },
  async open(argv) {
    let url = 'http://localhost:8601/';
    let screenshot: string | undefined;
    let headless = false;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--headless') headless = true;
      else if (argv[i] === '--url' || argv[i] === '--screenshot') {
        const option = argv[i];
        const value = argv[++i];
        if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
        if (option === '--url') url = value;
        else screenshot = value;
      } else throw new Error(`Unknown open option: ${argv[i]}`);
    }
    const { openSessionInBrowser } = await import('./session/browser.js');
    await openSessionInBrowser(await loadSession(), { url, headless, ...(screenshot ? { screenshot } : {}) });
  },
  // ── NLP Parse ────────────────────────────────────────────────────────────

  async nlpParse(argv) {
    const prompt = argv[0];
    const omlxEndpoint = process.env.OMLX_ENDPOINT || argv[1];
    const apiKey = process.env.OMLX_API_KEY || argv[2];

    if (!prompt) {
      console.error('Usage: scratch-session nlp-parse "<prompt>" [omlx_endpoint] [api_key]');
      process.exit(1);
    }

    const { parseNaturalLanguage } = await import('../nlp/parser.js');
    const result = await parseNaturalLanguage(prompt, omlxEndpoint, apiKey);

    console.log('Summary: ' + result.summary);
    console.log('Confidence: ' + (result.confidence * 100).toFixed(0) + '%');
    console.log('Commands:');
    result.commands.forEach((cmd, i) => {
      console.log('  ' + (i + 1) + '. ' + cmd.type + ' → ' + cmd.opcode);
      if (cmd.inputs) {
        console.log('     Inputs: ' + JSON.stringify(cmd.inputs));
      }
    });
  },

  // ── Preview Screenshot ───────────────────────────────────────────────────

  async previewScreenshot(argv) {
    await commands.preview(argv);
  },
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);

  if (!cmd) {
    console.error('scratch-session - Stateful Scratch project CLI\n');
    console.error('Usage: scratch-session <command> [args...]\n');
    console.error('Commands:');
    for (const c of Object.keys(commands).sort()) {
      console.error(`  ${c}`);
    }
    process.exit(1);
  }

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.error('scratch-session - Stateful Scratch project CLI\n');
    console.error('Examples: new MyGame | load game.sb3 | compile checked.sb3 | preview stage.png | open --url http://localhost:8601/');
    console.error('Guide: packages/scratch-ai-bridge/docs/USAGE-GUIDE.md\n');
    for (const [name] of Object.entries(commands).sort()) {
      console.error(`  ${name}`);
    }
    process.exit(0);
  }

  const handler = commands[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}`);
    console.error('Available commands:', Object.keys(commands).sort().join(', '));
    process.exit(1);
  }

  try {
    await handler(argv);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
