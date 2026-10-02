// Golden-output check: Markdown and DOCX parts of sample.json vs the committed files in tests/golden/.
//
//   node --test tests/golden/golden.test.mjs        compare (part of `npm test`)
//   node tests/golden/golden.test.mjs --update      regenerate the golden files (or: npm run golden:update)
//
// Regenerate only when an output change is intended, and review the diff of tests/golden/ before committing.
// `npm run test:e2e` checks the real browser produces the same Markdown and XML.
import test from 'node:test';
import assert from 'node:assert/strict';
import {vmOutputs, compareGolden, writeGolden} from './golden-lib.mjs';

const UPDATE = process.argv.includes('--update') || process.env.UPDATE_GOLDEN === '1';

if (UPDATE) {
  writeGolden(await vmOutputs());
  console.log('golden files updated: tests/golden/sample.md, tests/golden/docx/');
} else {
  test('golden: sample.json Markdown and DOCX parts (index.html)', async () => {
    const bad = compareGolden(await vmOutputs('index.html'));
    assert.deepEqual(bad, [], bad.join('\n'));
  });
  test('golden: artifact.html produces the same Markdown and DOCX XML', async () => {
    const bad = compareGolden(await vmOutputs('artifact.html'));
    assert.deepEqual(bad, [], bad.join('\n'));
  });
}
