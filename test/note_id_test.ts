/**
 * Unit tests for noteElementId()'s float-quantization (stage 3.3 of the
 * SumisoraOMR jianpu graphical editor): a note's data-id must stay stable
 * across re-renders even when `start` arrives via a different chain of
 * floating-point additions each time.
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
import { noteElementId } from '../src/jianpu_svg_render';

test('noteElementId: collapses float noise within the 1e-6 tolerance to the same id', (t: test.Test) => {
  // Real-world sample from the flufy3d/JianpuRender evaluation spike
  // (修复计划2与简谱编辑器规划.md B9.3.1): repeated block-length summation
  // produced 0.9999999959999997 instead of exactly 1.
  t.equal(noteElementId(0.9999999959999997, 67), noteElementId(1, 67),
    'drift of ~4e-9 must not change the id');
  t.equal(noteElementId(1.0000000041, 67), noteElementId(1, 67),
    'drift on the other side of the target value must also collapse');
  t.end();
});

test('noteElementId: distinct musical positions stay distinct', (t: test.Test) => {
  t.notEqual(noteElementId(1, 67), noteElementId(1.5, 67), 'different start times differ');
  t.notEqual(noteElementId(1, 67), noteElementId(1, 69), 'different pitches differ');
  t.end();
});

test('noteElementId: is a pure function of (start, pitch) — same inputs, same id every call', (t: test.Test) => {
  t.equal(noteElementId(2.5, 60), noteElementId(2.5, 60));
  t.end();
});
