// Before packaging (npm run dist): copy what a new workspace starts with — template, tools, scripts, refs,
// styles, skills and the agent's instructions — from the repo into build/workspace, which the installer puts
// in the app's Resources/workspace (server/workspace.ts copies it into the folder chosen on first run).
import path from 'node:path';
import {stageResources} from '../server/workspace.ts';

const out = path.resolve(import.meta.dirname, '../build/workspace');
stageResources(out);
console.log(`recursos de la carpeta de trabajo → ${out}`);
