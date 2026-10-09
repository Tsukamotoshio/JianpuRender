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

/** A token: a note `n`, a rest `0` or a dash `-`, with its duration and underlines. */
type Tok = [kind: 'n' | '0' | '-', duration: number, lines?: number];

/** A score from written measures; every slot carries its measure. */
function score(measures: Tok[][], numerator = 4, denominator = 4, withRef = true,
               noteExtra: Partial<NoteInfo> = {}): JianpuInfo {
  const notes: NoteInfo[] = [];
  const slots: SlotInfo[] = [];
  let t = 0;
  let held: NoteInfo | null = null;
  measures.forEach((toks, m) => toks.forEach(([kind, duration, lines = 0], index) => {
    const slot: SlotInfo = { start: t, duration, is_rest: kind === '0', is_dash: kind === '-', lines, dots: 0, dashes: 0 };
    if (withRef) slot.ref = { measure: m, index };
    slots.push(slot);
    if (kind === 'n') {
      held = { start: t, length: duration, pitch: 60 + slots.length, intensity: 80, jianpuNumber: 1, ...noteExtra };
      notes.push(held);
    } else if (kind === '-' && held) {
      held.length += duration;
    } else if (kind === '0') {
      held = null;
    }
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

// ── a note held across a barline is printed again, tied (stage V1h) ─────────

const blockAt = (blocks: JianpuBlock[], s: number) => blocks.find((b) => Math.abs(b.start - s) < 1e-6)!;

test('held across a barline: the `-` opening the measure is the note again, tied', (t: test.Test) => {
  // `1 - - - | - - 2 2`, which jianpu-ly prints as `1 - - -⌒| 1 - 2 2`.
  const blocks = blocksOf(score([[['n', 1], ['-', 1], ['-', 1], ['-', 1]], [['-', 1], ['-', 1], ['n', 1], ['n', 1]]]));
  const head = blockAt(blocks, 0).notes[0];
  const again = blockAt(blocks, 4);
  t.equal(again.notes.length, 1, 'a note');
  t.notOk(again.augmentationDash, 'drawn as a digit, not a dash');
  t.equal(again.notes[0].writtenTieFrom, head, 'tied from the head');
  t.equal(head.writtenTieTo, again.notes[0], 'and the head knows it');
  t.ok(blockAt(blocks, 5).augmentationDash, 'the next `-` in that measure is a dash again');
  t.end();
});

test('held across a barline: the repeat carries the accidental and octave dots', (t: test.Test) => {
  const blocks = blocksOf(score([[['n', 1], ['-', 1], ['-', 1], ['-', 1]], [['-', 1], ['n', 1], ['n', 1], ['n', 1]]],
    4, 4, true, { accidental: 1, octaveDot: 1, jianpuNumber: 4 }));
  const again = blockAt(blocks, 4).notes[0];
  t.deepEqual([again.jianpuNumber, again.accidental, again.octaveDot], [4, 1, 1], '#4 with a dot above, as the head');
  t.end();
});

test('held across a barline: the repeat keeps the underline of the dash it replaces', (t: test.Test) => {
  // `q4, q- | q- q5`: printed `4 -⌒| 4 5` with the repeated 4 underlined.
  const blocks = blocksOf(score([[['n', 1], ['n', 1], ['n', 1], ['n', 0.5, 1], ['-', 0.5, 1]], [['-', 0.5, 1], ['n', 0.5, 1], ['n', 1], ['n', 1], ['n', 1]]]));
  const again = blockAt(blocks, 4);
  t.equal(again.notes.length, 1, 'printed as the note');
  t.equal(again.durationLines, 1, 'with one underline');
  t.end();
});

test('held across a barline: a rest held across one stays a dash', (t: test.Test) => {
  const blocks = blocksOf(score([[['0', 1], ['-', 1], ['-', 1], ['-', 1]], [['-', 1], ['-', 1], ['n', 1], ['n', 1]]]));
  const b = blockAt(blocks, 4);
  t.equal(b.notes.length, 0, 'still part of the rest');
  t.ok(b.augmentationDash, 'drawn as a dash');
  t.end();
});

test('held across two barlines: each repeat is tied to the digit before it', (t: test.Test) => {
  const blocks = blocksOf(score([
    [['n', 1], ['-', 1], ['-', 1], ['-', 1]], [['-', 1], ['-', 1], ['-', 1], ['-', 1]], [['-', 1], ['n', 1], ['n', 1], ['n', 1]]]));
  const [head, first, second] = [0, 4, 8].map((s) => blockAt(blocks, s).notes[0]);
  t.equal(first.writtenTieFrom, head, 'first repeat tied from the head');
  t.equal(second.writtenTieFrom, first, 'second repeat tied from the first, not the head');
  t.end();
});

test('held across a barline: without measures in the slots the dash stays a dash', (t: test.Test) => {
  const blocks = blocksOf(score([[['n', 1], ['-', 1], ['-', 1], ['-', 1]], [['-', 1], ['n', 1], ['n', 1], ['n', 1]]], 4, 4, false));
  t.ok(blockAt(blocks, 4).augmentationDash);
  t.end();
});

// ── beams as jianpu-ly forms them (stage V1g) ───────────────────────────────

/** Starts of each beam group's blocks. */
function beamStarts(info: JianpuInfo): number[][] {
  const model = modelOf(info);
  return computeBeamGroups(Array.from(model.jianpuBlockMap.values()), model.measuresInfo)
    .map((g) => g.blocks.map((b) => b.start));
}

test('beams: an underlined rest is beamed with its neighbours, as jianpu-ly does', (t: test.Test) => {
  t.deepEqual(beamStarts(score([[['n', 0.5, 1], ['0', 0.5, 1], ['n', 1]]], 2, 4)), [[0, 0.5]], 'rest last in the beat');
  t.deepEqual(beamStarts(score([[['0', 0.5, 1], ['n', 0.5, 1], ['n', 1]]], 2, 4)), [[0, 0.5]], 'rest first in the beat');
  t.deepEqual(beamStarts(score([[['0', 0.25, 2], ['n', 0.25, 2], ['n', 0.25, 2], ['n', 0.25, 2], ['n', 1]]], 2, 4)),
    [[0, 0.25, 0.5, 0.75]], 'sixteenth rest and three sixteenths');
  t.end();
});

test('beams: the underlined dash lengthening a rest is beamed too', (t: test.Test) => {
  t.deepEqual(beamStarts(score([[['0', 0.5, 1], ['-', 0.5, 1], ['n', 1]]], 2, 4)), [[0, 0.5]]);
  t.end();
});

test('beams: a pickup counts its beats back from where a full bar would end', (t: test.Test) => {
  // A 1.5-beat pickup of three eighths in 4/4: jianpu-ly treats it as the
  // tail of a whole bar, so the beat boundary falls half a beat in and the
  // eighths group (1)(2 3); counted from the pickup's start they would be (1 2)(3).
  const info = score([[['n', 0.5, 1], ['n', 0.5, 1], ['n', 0.5, 1]], [['n', 1], ['n', 1], ['n', 1], ['n', 1]]]);
  info.anacrusis = 1.5;
  t.deepEqual(beamStarts(info), [[0.5, 1.0]]);
  delete info.anacrusis;
  t.deepEqual(beamStarts(info), [[0, 0.5]], 'without the declared pickup: counted from its start');
  t.end();
});

test('beams: without slots a rest still breaks the group (upstream)', (t: test.Test) => {
  const info: JianpuInfo = {
    notes: [{ start: 0, length: 0.5, pitch: 60, intensity: 80 }, { start: 1, length: 0.5, pitch: 62, intensity: 80 }],
    totalLength: 2,
    keySignatures: [{ start: 0, key: 0 }],
    timeSignatures: [{ start: 0, numerator: 2, denominator: 4 }],
  };
  const model = modelOf(info);
  const groups = computeBeamGroups(Array.from(model.jianpuBlockMap.values()), model.measuresInfo);
  t.ok(groups.every((g) => g.blocks.every((b) => b.notes.length > 0)), 'no rest in any group');
  t.end();
});
