/**
 * Unit tests for building blocks from the written tokens (stage V1d of the
 * SumisoraOMR jianpu graphical editor): with `slots`, every note and every
 * `-` that continues it is one block drawn as written -- no beat splitting,
 * no repeated tied digits.
 *
 * @license
 * Copyright 2025 flufy3d All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as test from 'tape';
import { JianpuInfo, NoteInfo, SlotInfo } from '../src/jianpu_info';
import { JianpuModel } from '../src/jianpu_model';
import { JianpuBlock } from '../src/jianpu_block';

type Tok = [kind: 'n' | '-' | '0', duration: number, lines?: number, dots?: number, dashes?: number];

/**
 * A one-staff score from written tokens: notes get pitch 60 + 2*i so each is
 * distinct, a note's sounding length runs through the `-` after it (as the
 * producer sends it), and every token becomes a slot.
 */
function score(toks: Tok[], numerator = 4, denominator = 4, extra: Partial<NoteInfo> = {}): JianpuInfo {
  const notes: NoteInfo[] = [];
  const slots: SlotInfo[] = [];
  let t = 0;
  let held: NoteInfo | null = null;
  toks.forEach(([kind, duration, lines = 0, dots = 0, dashes = 0], i) => {
    slots.push({ start: t, duration, is_rest: kind === '0', is_dash: kind === '-', lines, dots, dashes });
    if (kind === 'n') {
      held = { start: t, length: duration, pitch: 60 + 2 * i, intensity: 80, jianpuNumber: 1, ...extra };
      notes.push(held);
    } else if (kind === '-' && held) {
      held.length += duration;
    } else if (kind === '0') {
      held = null;
    }
    t += duration;
  });
  return {
    notes, slots, totalLength: t,
    keySignatures: [{ start: 0, key: 0 }],
    timeSignatures: [{ start: 0, numerator, denominator }],
  };
}

/** Blocks in drawing order. */
function blocksOf(info: JianpuInfo): JianpuBlock[] {
  return Array.from(new JianpuModel(info).jianpuBlockMap.values());
}

const shape = (b: JianpuBlock) =>
  [b.start, b.notes.length ? (b.augmentationDash ? '-' : 'n') : '0', b.durationLines ?? 0, b.augmentationDots ?? 0];

test('written slots: `6 - q- q6` is four blocks, the dashes drawn as dashes', (t: test.Test) => {
  const blocks = blocksOf(score([['n', 1], ['-', 1], ['-', 0.5, 1], ['n', 0.5, 1], ['0', 1]]));
  t.deepEqual(blocks.map(shape), [
    [0, 'n', 0, 0], [1, '-', 0, 0], [2, '-', 1, 0], [2.5, 'n', 1, 0], [3, '0', 0, 0],
  ]);
  t.ok(blocks.every((b) => b.notes.every((n) => !n.tiedFrom && !n.tiedTo)), 'no tie links, so no tie arcs');
  t.end();
});

test('written slots: a dotted quarter stays one dotted block', (t: test.Test) => {
  const blocks = blocksOf(score([['n', 1.5, 0, 1], ['n', 0.5, 1], ['n', 1], ['n', 1]]));
  t.deepEqual(blocks.map(shape), [[0, 'n', 0, 1], [1.5, 'n', 1, 0], [2, 'n', 0, 0], [3, 'n', 0, 0]]);
  t.end();
});

test('written slots: a quarter note in 6/8 is not split into tied eighths', (t: test.Test) => {
  const blocks = blocksOf(score([['n', 1], ['n', 0.5, 1], ['n', 1], ['n', 0.5, 1]], 6, 8));
  t.deepEqual(blocks.map(shape), [[0, 'n', 0, 0], [1, 'n', 1, 0], [1.5, 'n', 0, 0], [2.5, 'n', 1, 0]]);
  t.end();
});

test('written slots: a note lengthened by an edit is a head plus its dashes', (t: test.Test) => {
  const blocks = blocksOf(score([['n', 3, 0, 0, 2], ['n', 1]]));
  t.deepEqual(blocks.map(shape), [[0, 'n', 0, 0], [1, '-', 0, 0], [2, '-', 0, 0], [3, 'n', 0, 0]]);
  t.equal(blocks[0].length, 1, 'the head is one beat');
  t.end();
});

test('written slots: a `-` after a rest stays part of the rest', (t: test.Test) => {
  const blocks = blocksOf(score([['n', 1], ['0', 1], ['-', 1], ['n', 1]]));
  const between = blocks.filter((b) => b.start > 0.5 && b.start < 2.5);
  t.ok(between.length > 0, 'the rest is drawn');
  t.ok(between.every((b) => b.notes.length === 0), 'and nothing in it carries a note');
  t.deepEqual(blocks.filter((b) => b.notes.length).map((b) => b.start), [0, 3], 'only the two notes');
  t.end();
});

test('written slots: a dash keeps the pitch but not the accidental or marks', (t: test.Test) => {
  const blocks = blocksOf(score([['n', 1], ['-', 1], ['n', 2, 0, 0, 1]], 4, 4,
    { accidental: 1, dynamic: 'f', hairpinStart: '<' }));
  const [head, dash] = [blocks[0].notes[0], blocks[1].notes[0]];
  t.equal(dash.pitch, head.pitch, 'same pitch, so the drawn group keys stay unique per start');
  t.equal(head.accidental, 1, 'the head has its sharp');
  t.equal(dash.accidental, 0, 'the dash has none');
  t.equal(dash.dynamic, undefined, 'no dynamic on the dash');
  t.equal(dash.hairpinStart, undefined, 'no hairpin on the dash');
  t.end();
});

test('written slots: without slots the upstream splitting is unchanged', (t: test.Test) => {
  const info = score([['n', 1], ['-', 1]]);
  delete info.slots;
  // A two-beat note in 4/4, derived the upstream way: a head and a dash block.
  const blocks = blocksOf(info);
  const rounded = blocks.filter((b) => b.notes.length).map(shape)
    .map(([start, ...rest]) => [Math.round(Number(start) * 1e4) / 1e4, ...rest]);
  t.deepEqual(rounded, [[0, 'n', 0, 0], [1, '-', 0, 0]], 'starts compared rounded: upstream snaps to a grid');
  t.ok(blocks[1].notes[0].tiedFrom, 'upstream links the pieces with a tie');
  t.end();
});

test('written slots: a block that ends a beat is marked so, for spacing', (t: test.Test) => {
  // The renderer leaves a full gap after a block that ends a beat. Without the
  // mark the last sixteenth before a barline sat flush against it.
  const blocks = blocksOf(score([['n', 0.5, 1], ['n', 0.5, 1], ['n', 0.25, 2], ['n', 0.75, 1, 1]]));
  t.deepEqual(blocks.map((b) => !!b.beatEnd), [false, true, false, true]);
  t.end();
});
