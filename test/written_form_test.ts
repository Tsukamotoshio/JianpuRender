/**
 * Unit tests for drawing a note as written (stage V0 of the SumisoraOMR jianpu
 * graphical editor). A caller that knows the digit, octave dots and
 * accidental gets exactly those; one that only has a MIDI pitch keeps
 * upstream's derivation.
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
import { JianpuInfo, NoteInfo } from '../src/jianpu_info';
import { JianpuModel, mapMidiToJianpu } from '../src/jianpu_model';
import { JianpuNote } from '../src/jianpu_block';

/** A score in 4/4 holding the given notes, in the key with this tonic pitch class. */
function scoreOf(notes: NoteInfo[], key: number): JianpuInfo {
  return {
    notes,
    keySignatures: [{ start: 0, key }],
    timeSignatures: [{ start: 0, numerator: 4, denominator: 4 }],
  };
}

/** Every note the model produced, in time order. */
function notesOf(model: JianpuModel): JianpuNote[] {
  return Array.from(model.jianpuBlockMap.keys())
    .sort((a, b) => a - b)
    .flatMap((start) => model.jianpuBlockMap.get(start)!.notes);
}

test('written form: a note in 1=D keeps the octave it was written in', (t: test.Test) => {
  // `2` in 1=D is E4 (64). Upstream puts the dot-less D in octave 3 for every
  // key but C, so on its own it would draw this note with one dot above.
  t.equal(mapMidiToJianpu(64, 2).octaveDot, 1, 'the derivation this guards against');
  const [note] = notesOf(new JianpuModel(scoreOf([
    { start: 0, length: 1, pitch: 64, intensity: 80, jianpuNumber: 2, octaveDot: 0, accidental: 0 },
  ], 2)));
  t.equal(note.jianpuNumber, 2, 'digit as written');
  t.equal(note.octaveDot, 0, 'no dot, as written');
  t.end();
});

test('written form: the accidental is spelled as written, not respelled', (t: test.Test) => {
  // Upstream has one fixed spelling per semitone: F# is always #4, G# is
  // always b6. A score that writes #5 (common in minor keys) must keep it.
  t.deepEqual(mapMidiToJianpu(66, 0), { jianpuNumber: 4, octaveDot: 0, accidental: 1 },
    'F# comes out as #4');
  t.deepEqual(mapMidiToJianpu(68, 0), { jianpuNumber: 6, octaveDot: 0, accidental: 2 },
    'G# comes out as b6');
  const [note] = notesOf(new JianpuModel(scoreOf([
    { start: 0, length: 1, pitch: 68, intensity: 80, jianpuNumber: 5, octaveDot: 0, accidental: 1 },
  ], 0)));
  t.equal(note.jianpuNumber, 5, 'digit 5');
  t.equal(note.accidental, 1, 'with its sharp');
  t.end();
});

test('written form: dots below are kept, and absent dots mean none', (t: test.Test) => {
  const notes = notesOf(new JianpuModel(scoreOf([
    { start: 0, length: 1, pitch: 43, intensity: 80, jianpuNumber: 5, octaveDot: -1 },
    { start: 1, length: 1, pitch: 60, intensity: 80, jianpuNumber: 1 },
  ], 0)));
  t.equal(notes[0].octaveDot, -1, 'one dot below');
  t.equal(notes[0].accidental, 0, 'absent accidental is none');
  t.equal(notes[1].octaveDot, 0, 'absent dots are none');
  t.end();
});

test('written form: without a digit the pitch is still derived (upstream input)', (t: test.Test) => {
  const [note] = notesOf(new JianpuModel(scoreOf([
    { start: 0, length: 1, pitch: 64, intensity: 80 },
  ], 2)));
  t.deepEqual([note.jianpuNumber, note.octaveDot, note.accidental], [2, 1, 0],
    'exactly what mapMidiToJianpu gives');
  t.end();
});

test('written form: both halves of a split note show the written digit and dots', (t: test.Test) => {
  // 5 quarters in 4/4 crosses the bar line, so the model splits it in two.
  const notes = notesOf(new JianpuModel(scoreOf([
    { start: 0, length: 5, pitch: 64, intensity: 80, jianpuNumber: 2, octaveDot: 0, accidental: 1 },
  ], 2)));
  t.ok(notes.length >= 2, 'the note was split');
  t.ok(notes.every((n) => n.jianpuNumber === 2 && n.octaveDot === 0), 'every fragment reads 2, no dot');
  t.equal(notes[0].accidental, 1, 'the first fragment carries the sharp');
  t.ok(notes.slice(1).every((n) => n.accidental === 0), 'later fragments do not repeat it');
  t.end();
});
