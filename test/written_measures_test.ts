/**
 * Unit tests for following the written measures (stage V1f of the SumisoraOMR
 * jianpu graphical editor): with `slots` that carry their measure, barlines,
 * beat spacing and beam groups follow the text -- a pickup, an overfull OMR
 * measure -- instead of measures re-derived from the time signature.
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
import { computeBeamGroups } from '../src/beam_grouping';

/** A token: a note `n` or a rest `0`, with its duration and underlines. */
type Tok = [kind: 'n' | '0', duration: number, lines?: number];

/** A score from written measures; every slot carries its measure. */
function score(measures: Tok[][], numerator = 4, denominator = 4, withRef = true): JianpuInfo {
  const notes: NoteInfo[] = [];
  const slots: SlotInfo[] = [];
  let t = 0;
  measures.forEach((toks, m) => toks.forEach(([kind, duration, lines = 0], index) => {
    const slot: SlotInfo = { start: t, duration, is_rest: kind === '0', is_dash: false, lines, dots: 0, dashes: 0 };
    if (withRef) slot.ref = { measure: m, index };
    slots.push(slot);
    if (kind === 'n') notes.push({ start: t, length: duration, pitch: 60 + slots.length, intensity: 80, jianpuNumber: 1 });
    t += duration;
  }));
  return {
    notes, slots, totalLength: t,
    keySignatures: [{ start: 0, key: 0 }],
    timeSignatures: [{ start: 0, numerator, denominator }],
  };
}

function modelOf(info: JianpuInfo): JianpuModel {
  return new JianpuModel(info);
}

function blocksOf(info: JianpuInfo): JianpuBlock[] {
  return Array.from(modelOf(info).jianpuBlockMap.values());
}

/** Starts of the blocks a barline is drawn before (not counting time 0). */
const barlineStarts = (blocks: JianpuBlock[]) =>
  blocks.filter((b) => b.start > 1e-6 && b.isMeasureBeginning()).map((b) => b.start);

test('written measures: a pickup puts the barlines after it, not on the time grid', (t: test.Test) => {
  // 2/4 with an eighth-note pickup: the text's barlines fall at 0.5 and 2.5;
  // counted from 0 by the time signature they would fall at 2.
  const blocks = blocksOf(score([[['n', 0.5, 1]], [['n', 1], ['n', 1]], [['n', 1], ['n', 1]]], 2, 4));
  t.deepEqual(barlineStarts(blocks), [0.5, 2.5]);
  t.equal(blocks.find((b) => b.start === 0.5)!.measureNumber, 2, 'the measure after the pickup is measure 2');
  t.end();
});

test('written measures: an overfull measure keeps its own barline', (t: test.Test) => {
  // OMR output: five beats in a 4/4 measure. The barline goes where the text has it.
  const blocks = blocksOf(score([[['n', 1], ['n', 1], ['n', 1], ['n', 1], ['n', 1]], [['n', 1], ['n', 1]]]));
  t.deepEqual(barlineStarts(blocks), [5]);
  t.end();
});

test('written measures: a rest across a written barline is cut there', (t: test.Test) => {
  // Pickup, then `0 0 | 0 1` in 2/4: one gap of rests from 0.5 to 3.5. A
  // barline needs a block to stand before, so the gap is cut at 2.5.
  const blocks = blocksOf(score([[['n', 0.5, 1]], [['0', 1], ['0', 1]], [['0', 1], ['n', 1]]], 2, 4));
  t.deepEqual(barlineStarts(blocks), [0.5, 2.5]);
  const at = (s: number) => blocks.find((b) => Math.abs(b.start - s) < 1e-6);
  t.ok(at(2.5) && at(2.5)!.notes.length === 0, 'a rest starts the third measure');
  t.end();
});

test('written measures: beams count beats from the written measure start', (t: test.Test) => {
  // Pickup eighth, then four eighths: beats of the second measure start at 0.5
  // and 1.5, so the eighths pair up as (0.5, 1.0) and (1.5, 2.0).
  const info = score([[['n', 0.5, 1]], [['n', 0.5, 1], ['n', 0.5, 1], ['n', 0.5, 1], ['n', 0.5, 1]]], 2, 4);
  const model = modelOf(info);
  const groups = computeBeamGroups(Array.from(model.jianpuBlockMap.values()), model.measuresInfo);
  t.deepEqual(groups.map((g) => g.blocks.map((b) => b.start)), [[0.5, 1.0], [1.5, 2.0]]);
  t.end();
});

test('written measures: the last block of an overfull measure ends it (spacing)', (t: test.Test) => {
  const blocks = blocksOf(score([[['n', 1], ['n', 1], ['n', 1], ['n', 1], ['n', 0.5, 1], ['n', 0.5, 1]], [['n', 1]]]));
  const at = (s: number) => blocks.find((b) => Math.abs(b.start - s) < 1e-6)!;
  t.equal(at(4).beatEnd, false, 'mid-beat');
  t.equal(at(4.5).beatEnd, true, 'the written measure ends here');
  t.end();
});

test('written measures: slots without a measure fall back to the time grid', (t: test.Test) => {
  const blocks = blocksOf(score([[['n', 0.5, 1]], [['n', 1], ['n', 1]], [['n', 1], ['n', 1]]], 2, 4, false));
  t.notOk(blocks.find((b) => b.start === 0.5)!.isMeasureBeginning(), 'no barline after the pickup');
  t.end();
});

test('written measures: rests are split on the written beats, not the time grid', (t: test.Test) => {
  // Pickup eighth in 2/4, then a one-beat rest: the written beat runs 0.5-1.5,
  // so the rest is one block. Counted from 0 it would be cut at 1.0 into an
  // eighth rest and a sixteenth-dotted remainder.
  const blocks = blocksOf(score([[['n', 0.5, 1]], [['0', 1], ['n', 1]]], 2, 4));
  const rests = blocks.filter((b) => b.notes.length === 0);
  t.deepEqual(rests.map((b) => [b.start, b.length]), [[0.5, 1]]);
  t.end();
});
