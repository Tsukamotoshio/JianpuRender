/**
 * Unit tests for beam_grouping.ts (stage 3.4 of the SumisoraOMR jianpu
 * graphical editor): grouping rules are derived from, and must match,
 * scripts/jianpu-ly.py's actual beam-restart logic (see beam_grouping.ts's
 * module docs for the exact reference-implementation excerpt).
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
import { JianpuBlock, JianpuNote } from '../src/jianpu_block';
import { MeasuresInfo } from '../src/measure_info';
import { JianpuInfo, TimeSignatureInfo } from '../src/jianpu_info';
import {
  beamBeatLengthQL, beamLevelsBetweenConsecutiveBlocks, computeBeamGroups, isCompoundTime,
} from '../src/beam_grouping';

function makeMeasuresInfo(timeSignature: TimeSignatureInfo, lastQ = 16): MeasuresInfo {
  const jianpuInfo: JianpuInfo = {
    notes: [],
    tempos: [{ start: 0, qpm: 60 }],
    keySignatures: [{ start: 0, key: 0 }],
    timeSignatures: [{ ...timeSignature, start: 0 }],
  };
  return new MeasuresInfo(jianpuInfo, lastQ);
}

let noteSeq = 0;
function note(pitch = 60): JianpuNote {
  noteSeq += 1;
  return {
    start: 0, length: 0, pitch, intensity: 80,
    jianpuNumber: 1, octaveDot: 0, accidental: 0,
  };
}

/** A beamable block (has a real note + durationLines) at [start, start+length). */
function beamableBlock(start: number, length: number, durationLines: number): JianpuBlock {
  const b = new JianpuBlock(start, length, [note()], 1);
  b.durationLines = durationLines;
  return b;
}

/** A rest block (no notes) at [start, start+length). */
function restBlock(start: number, length: number): JianpuBlock {
  return new JianpuBlock(start, length, [], 1);
}

/** A non-beamable note block (quarter or longer; durationLines left undefined/0). */
function plainNoteBlock(start: number, length: number): JianpuBlock {
  return new JianpuBlock(start, length, [note()], 1);
}

test('isCompoundTime / beamBeatLengthQL: matches jianpu-ly.py setTime()', (t: test.Test) => {
  t.equal(isCompoundTime({ start: 0, numerator: 4, denominator: 4 }), false, '4/4 is simple');
  t.equal(isCompoundTime({ start: 0, numerator: 3, denominator: 4 }), false, '3/4 is simple (denominator not > 4)');
  t.equal(isCompoundTime({ start: 0, numerator: 6, denominator: 8 }), true, '6/8 is compound');
  t.equal(isCompoundTime({ start: 0, numerator: 9, denominator: 8 }), true, '9/8 is compound');
  t.equal(isCompoundTime({ start: 0, numerator: 12, denominator: 8 }), true, '12/8 is compound');
  t.equal(isCompoundTime({ start: 0, numerator: 5, denominator: 8 }), false, '5/8 is not (numerator not a multiple of 3)');
  t.equal(isCompoundTime({ start: 0, numerator: 7, denominator: 8 }), false, '7/8 is not');
  t.equal(beamBeatLengthQL({ start: 0, numerator: 4, denominator: 4 }), 1.0, '4/4 beats are a quarter note');
  t.equal(beamBeatLengthQL({ start: 0, numerator: 6, denominator: 8 }), 1.5, '6/8 beats are a dotted quarter');
  t.end();
});

test('computeBeamGroups: 4/4, four eighth notes filling a full bar -> two beat-groups of two', (t: test.Test) => {
  const measuresInfo = makeMeasuresInfo({ start: 0, numerator: 4, denominator: 4 });
  const blocks = [
    beamableBlock(0, 0.5, 1), beamableBlock(0.5, 0.5, 1),
    beamableBlock(1.0, 0.5, 1), beamableBlock(1.5, 0.5, 1),
  ];
  const groups = computeBeamGroups(blocks, measuresInfo);
  t.equal(groups.length, 2, 'restarts every quarter-note beat in simple time');
  t.equal(groups[0].blocks.length, 2);
  t.equal(groups[1].blocks.length, 2);
  t.end();
});

test('computeBeamGroups: 4/4, four sixteenth notes filling one beat -> one group of four', (t: test.Test) => {
  const measuresInfo = makeMeasuresInfo({ start: 0, numerator: 4, denominator: 4 });
  const blocks = [
    beamableBlock(0, 0.25, 2), beamableBlock(0.25, 0.25, 2),
    beamableBlock(0.5, 0.25, 2), beamableBlock(0.75, 0.25, 2),
  ];
  const groups = computeBeamGroups(blocks, measuresInfo);
  t.equal(groups.length, 1, 'does not restart mid-beat');
  t.equal(groups[0].blocks.length, 4);
  t.end();
});

test('computeBeamGroups: 6/8, three eighth notes filling one compound beat -> one group of three', (t: test.Test) => {
  const measuresInfo = makeMeasuresInfo({ start: 0, numerator: 6, denominator: 8 });
  const blocks = [beamableBlock(0, 0.5, 1), beamableBlock(0.5, 0.5, 1), beamableBlock(1.0, 0.5, 1)];
  const groups = computeBeamGroups(blocks, measuresInfo);
  t.equal(groups.length, 1, 'the whole dotted-quarter beat groups together, unlike simple time');
  t.equal(groups[0].blocks.length, 3);
  t.end();
});

test('computeBeamGroups: 6/8, six eighth notes filling a full bar -> two groups of three (one per compound beat)', (t: test.Test) => {
  const measuresInfo = makeMeasuresInfo({ start: 0, numerator: 6, denominator: 8 });
  const blocks = Array.from({ length: 6 }, (_v, i) => beamableBlock(i * 0.5, 0.5, 1));
  const groups = computeBeamGroups(blocks, measuresInfo);
  t.equal(groups.length, 2);
  t.equal(groups[0].blocks.length, 3);
  t.equal(groups[1].blocks.length, 3);
  t.end();
});

test('computeBeamGroups: a rest splits an otherwise-contiguous run into two groups', (t: test.Test) => {
  const measuresInfo = makeMeasuresInfo({ start: 0, numerator: 4, denominator: 4 });
  // Thirty-second notes (0.125ql) so "note, note, rest, note, note" (5 slots)
  // fits inside a single 1.0ql beat (8 slots) without any side coincidentally
  // also landing on the beat boundary -- isolating the rest as the only
  // thing splitting the run (see comment history for why sixteenths don't work).
  const blocks = [
    beamableBlock(0, 0.125, 3), beamableBlock(0.125, 0.125, 3),
    restBlock(0.25, 0.125),
    beamableBlock(0.375, 0.125, 3), beamableBlock(0.5, 0.125, 3),
  ];
  const groups = computeBeamGroups(blocks, measuresInfo);
  t.equal(groups.length, 2, 'the rest breaks the run even though it does not fall on a beat boundary');
  t.equal(groups[0].blocks.length, 2);
  t.equal(groups[1].blocks.length, 2);
  t.end();
});

test('computeBeamGroups: an isolated beamable note between quarter notes produces no group', (t: test.Test) => {
  const measuresInfo = makeMeasuresInfo({ start: 0, numerator: 4, denominator: 4 });
  const blocks = [plainNoteBlock(0, 1.0), beamableBlock(1.0, 0.5, 1), plainNoteBlock(1.5, 0.5), plainNoteBlock(2.0, 1.0)];
  const groups = computeBeamGroups(blocks, measuresInfo);
  t.equal(groups.length, 0, 'a lone beamable note has nothing to merge with');
  t.end();
});

test('computeBeamGroups: restarts at the barline even mid-beat-length (short final bar/anacrusis-style)', (t: test.Test) => {
  const measuresInfo = makeMeasuresInfo({ start: 0, numerator: 4, denominator: 4 });
  // Two eighth notes exactly filling a 2/4-shaped remainder is out of scope here;
  // simpler: four sixteenths where the *last* one lands exactly on the barline of
  // a 1-beat-long custom time signature, forcing a measure-end flush rather than
  // a beat-boundary flush.
  const oneBeatMeasures = makeMeasuresInfo({ start: 0, numerator: 1, denominator: 4 }, 8);
  const blocks = [
    beamableBlock(0, 0.25, 2), beamableBlock(0.25, 0.25, 2),
    beamableBlock(0.5, 0.25, 2), beamableBlock(0.75, 0.25, 2),
    // Next measure starts at 1.0 -- must NOT merge with the previous group.
    beamableBlock(1.0, 0.25, 2), beamableBlock(1.25, 0.25, 2),
  ];
  const groups = computeBeamGroups(blocks, oneBeatMeasures);
  t.equal(groups.length, 2, 'never merges across a barline');
  t.equal(groups[0].blocks.length, 4);
  t.equal(groups[1].blocks.length, 2);
  t.end();
});

test('beamLevelsBetweenConsecutiveBlocks: mixed eighth+sixteenth connects only at the shared level', (t: test.Test) => {
  const group = { blocks: [beamableBlock(0, 0.75, 1), beamableBlock(0.75, 0.25, 2)] };
  const levels = beamLevelsBetweenConsecutiveBlocks(group);
  t.deepEqual(levels, [1, 0], 'connector level is min(1,2)=1; last block has no next-neighbour connector');
  t.end();
});

test('beamLevelsBetweenConsecutiveBlocks: uniform sixteenth run connects at both levels throughout', (t: test.Test) => {
  const group = {
    blocks: [beamableBlock(0, 0.25, 2), beamableBlock(0.25, 0.25, 2), beamableBlock(0.5, 0.25, 2), beamableBlock(0.75, 0.25, 2)],
  };
  const levels = beamLevelsBetweenConsecutiveBlocks(group);
  t.deepEqual(levels, [2, 2, 2, 0]);
  t.end();
});
