import assert from 'node:assert/strict';
import { validateProfile, collectEvidence } from '../profiles';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const bundle = { files: [{ file: 'src/game.js', content: 'function rotatePiece() {}\nfunction clearRows() {}' }], inventory: ['src/game.js'], fingerprint: 'fixture', truncated: false };
const result = validateProfile({ summary: 'A falling-block game', kind: 'game', apps: [], tags: [
  { category: 'features', label: 'piece-rotation', confidence: 'supported', evidence: [{ file: 'src/game.js', line: 1, quote: 'function rotatePiece()' }] },
  { category: 'features', label: 'payments', confidence: 'supported', evidence: [{ file: 'src/game.js', line: 1, quote: 'stripe.checkout' }] },
  { category: 'features', label: 'outside', confidence: 'supported', evidence: [{ file: '../secret', line: 1, quote: 'secret' }] }
] }, bundle);
assert.deepEqual(result.tags.map(t => t.label), ['piece-rotation']);
const meaning = require('../../public/meaning.js');
const project = { path: '/game', tech: ['HTML'], profile: result };
assert.equal(meaning.compare(project, { path: '/workspace', tech: ['HTML'] }).score, 0);
assert.equal(meaning.compare(project, { path: '/other-game', tech: [], profile: result }).reasons[0], 'Both: piece rotation');

async function samplingCases() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qnav-profile-fixture-'));
  try {
    for (const name of ['Intro.html', 'Updated.html', 'LEVEL1.html']) await fs.writeFile(path.join(directory, name), '<script>function playGame() {}</script>');
    assert.ok((await collectEvidence(directory)).files.some(f => f.file === 'LEVEL1.html'));
    await fs.writeFile(path.join(directory, 'package.json'), '{"name":"workspace"}');
    await fs.mkdir(path.join(directory, 'nested'), { recursive: true });
    await fs.writeFile(path.join(directory, 'nested/package.json'), '{"name":"unrelated"}');
    await fs.writeFile(path.join(directory, 'nested/game.js'), 'function unrelatedGame() {}');
    const app = await collectEvidence(directory);
    assert.ok(app.inventory.includes('nested/package.json'));
    assert.ok(!app.files.some(f => f.file === 'nested/game.js'));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
void samplingCases();
