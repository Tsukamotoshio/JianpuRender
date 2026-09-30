/**
 * Unit tests for the dynamic marks a note can carry (stage 6.1d of the
 * SumisoraOMR jianpu graphical editor). Drawing itself is verified in a real
 * browser; what is checked here is that the mark reaches the block model at
 * all, and that splitting a note does not duplicate it.
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
import { JianpuInfo } from '../src/jianpu_info';
import { JianpuModel } from '../src/jianpu_model';
import { splitJianpuNote, JianpuNote } from '../src/jianpu_block';

/** A one-note score in 4/4, C major, with the note's mark and length given. */
function scoreWith(dynamic: string | undefined, length = 1): JianpuInfo {
  return {
    notes: [{ start: 0, length, pitch: 60, intensity: 80, dynamic }],
    keySignatures: [{ start: 0, key: 0 }],
    timeSignatures: [{ start: 0, numerator: 4, denominator: 4 }],
  };
}

/** Every note the model produced, in time order. */
function notesOf(model: JianpuModel): JianpuNote[] {
  return Array.from(model.jianpuBlockMap.keys())
    .sort((a, b) => a - b)
    .flatMap((start) => model.jianpuBlockMap.get(start)!.notes);
}

test('dynamic: the mark on a NoteInfo reaches the note in the block model', (t: test.Test) => {
  const notes = notesOf(new JianpuModel(scoreWith('mf')));
  t.equal(notes.length, 1, 'one note');
  t.equal(notes[0].dynamic, 'mf', 'and it carries its mark');
  t.end();
});

test('dynamic: a note without one simply has none', (t: test.Test) => {
  const notes = notesOf(new JianpuModel(scoreWith(undefined)));
  t.equal(notes[0].dynamic, undefined, 'no mark invented');
  t.end();
});

test('dynamic: splitting a note leaves the mark on the first half only', (t: test.Test) => {
  // A mark drawn under both halves of one sounding note would read as two.
  const note: JianpuNote = {
    start: 0, length: 2, pitch: 60, intensity: 80, dynamic: 'f',
    jianpuNumber: 1, octaveDot: 0, accidental: 0,
  };
  const second = splitJianpuNote(note, 1);
  t.ok(second, 'the note did split');
  t.equal(note.dynamic, 'f', 'first half keeps the mark');
  t.equal(second!.dynamic, undefined, 'second half has none');
  t.end();
});

test('dynamic: a note long enough for the model to split keeps exactly one mark', (t: test.Test) => {
  // 5 quarters in 4/4 crosses the bar line, so the model splits it in two.
  const marked = notesOf(new JianpuModel(scoreWith('pp', 5))).filter((n) => n.dynamic);
  t.equal(marked.length, 1, 'drawn once, not once per fragment');
  t.equal(marked[0].start, 0, 'on the fragment the note starts at');
  t.end();
});

test('hairpin: both halves reach the block model on their own notes', (t: test.Test) => {
  const info: JianpuInfo = {
    notes: [
      { start: 0, length: 1, pitch: 60, intensity: 80, hairpinStart: '<' },
      { start: 1, length: 1, pitch: 62, intensity: 80, hairpinEnd: true },
    ],
    keySignatures: [{ start: 0, key: 0 }],
    timeSignatures: [{ start: 0, numerator: 4, denominator: 4 }],
  };
  const notes = notesOf(new JianpuModel(info));
  t.equal(notes[0].hairpinStart, '<', 'the note it starts on');
  t.equal(notes[1].hairpinEnd, true, 'the note it ends on');
  t.equal(notes[0].hairpinEnd, undefined, 'and nothing invented on either');
  t.end();
});

test('hairpin: splitting a note leaves its half on the first fragment only', (t: test.Test) => {
  const note: JianpuNote = {
    start: 0, length: 2, pitch: 60, intensity: 80, hairpinStart: '>', hairpinEnd: true,
    jianpuNumber: 1, octaveDot: 0, accidental: 0,
  };
  const second = splitJianpuNote(note, 1);
  t.equal(note.hairpinStart, '>', 'first half keeps the start');
  t.equal(second!.hairpinStart, undefined, 'second half has none');
  t.equal(second!.hairpinEnd, undefined, 'nor an end it never had');
  t.end();
});
