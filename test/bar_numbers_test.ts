/**
 * Unit tests for the printed bar numbers (stage V2f of the SumisoraOMR jianpu
 * graphical editor): LilyPond's numbering, a pickup counted as bar 0.
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
import { printedBarNumber } from '../src/bar_numbers';

/** Written measures of quarter notes (lengths in quarters), every slot carrying its measure. */
function score(measures: number[][], numerator: number, anacrusis?: number): JianpuInfo {
  const notes: NoteInfo[] = [];
  const slots: SlotInfo[] = [];
  let t = 0;
  measures.forEach((durations, m) => durations.forEach((duration, index) => {
    slots.push({ start: t, duration, is_rest: false, is_dash: false, lines: duration < 1 ? 1 : 0, dots: 0, dashes: 0,
                 ref: { measure: m, index } });
    notes.push({ start: t, length: duration, pitch: 60 + slots.length, intensity: 80, jianpuNumber: 1 });
    t += duration;
  }));
  return {
    notes, slots, totalLength: t, anacrusis,
    keySignatures: [{ start: 0, key: 0 }],
    timeSignatures: [{ start: 0, numerator, denominator: 4 }],
  };
}

/** The printed number of the measure each written measure's first block starts. */
function numbers(info: JianpuInfo): number[] {
  const blocks = Array.from(new JianpuModel(info).jianpuBlockMap.values());
  return blocks.filter((b) => b.isMeasureBeginning())
    .map((b) => printedBarNumber(b.measureNumber, !!info.anacrusis));
}

test('bar numbers: counted from 1', (t: test.Test) => {
  t.deepEqual(numbers(score([[1, 1], [1, 1], [1, 1]], 2)), [1, 2, 3]);
  t.end();
});

test('bar numbers: a pickup is bar 0, the first full measure bar 1', (t: test.Test) => {
  // 2/4 with an eighth-note pickup, as 天空之城 opens.
  t.deepEqual(numbers(score([[0.5], [1, 1], [1, 1]], 2, 0.5)), [0, 1, 2]);
  t.end();
});

test('bar numbers: a block inside a measure has its measure\'s number', (t: test.Test) => {
  t.equal(printedBarNumber(3.5, false), 3);
  t.equal(printedBarNumber(3.5, true), 2);
  t.equal(printedBarNumber(2.9999999, false), 3, 'a start a hair short of a whole measure is that measure');
  t.end();
});
