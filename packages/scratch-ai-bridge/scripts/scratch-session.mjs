#!/usr/bin/env node
// scratch-session CLI: Stateful Scratch project CLI for AI agents.
import { register } from 'tsx/esm/api';

register();
await import('../src/cli/session-cli.ts');
