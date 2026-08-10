/**
 * @license
 * Copyright 2025 flufy3d. All Rights Reserved.
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
 * =============================================================================
 */

import { JianpuBlock } from './jianpu_block';
import { TimeSignatureInfo } from './jianpu_info';
import { MeasuresInfo } from './measure_info';

/**
 * Beam-grouping rule, reverse-engineered from the reference jianpu-ly.py
 * implementation this project's own PDF export pipeline uses (see
 * scripts/jianpu-ly.py in the SumisoraOMR repo, class NoteheadMarkup):
 *
 *   def setTime(self, num, denom):
 *       self.barLength = int(64*num/denom)
 *       if denom > 4 and num % 3 == 0: self.beatLength = 24  # compound time
 *       else: self.beatLength = 16                            # simple time
 *   ...
 *   if (self.barPos % self.beatLength == 0 or self.barPos == self.barLength) \
 *           and self.inBeamGroup:
 *       # jianpu printouts tend to restart beams every beat
 *
 * In quarter-note terms (barLength/beatLength above are in 64th-note units,
 * i.e. 16 sixty-fourths = 1 quarter): a beam group is a run of *consecutive*
 * beamable blocks (duration shorter than a quarter, i.e. `durationLines >=
 * 1`, and not a rest) that never crosses a beat boundary or a barline, where
 * one beat is:
 *   - a dotted quarter (1.5 quarters) in compound time — denominator > 4
 *     AND numerator is a multiple of 3 (6/8, 9/8, 12/8, ...);
 *   - a plain quarter (1.0 quarters) otherwise (2/4, 3/4, 4/4, 2/2, 5/8,
 *     7/8, ...).
 *
 * Deliberate simplification vs. the reference: jianpu-ly.py's "rest hack"
 * (use_rest_hack) sometimes keeps a beam group logically running across a
 * short rest by substituting an invisible note, purely as a LilyPond
 * engraving workaround. This implementation always breaks a group at a
 * rest — the plainer, more common convention, and the one a human would
 * expect reading the numbers off the page even if jianpu-ly's PDF output
 * occasionally bridges a short rest for typesetting reasons.
 */

function isSafeZero(n: number): boolean {
  return Math.abs(n) < 1e-6;
}

/** True for compound time signatures (6/8, 9/8, 12/8, ...) per jianpu-ly.py's setTime(). */
export function isCompoundTime(timeSignature: TimeSignatureInfo): boolean {
  return timeSignature.denominator > 4 && timeSignature.numerator % 3 === 0;
}

/** Beat length in quarter notes for beam-grouping purposes (see module docs). */
export function beamBeatLengthQL(timeSignature: TimeSignatureInfo): number {
  return isCompoundTime(timeSignature) ? 1.5 : 1.0;
}

/**
 * Time elapsed since the start of the measure containing `time`, in quarter
 * notes. Reconstructed from MeasuresInfo's public API the same way
 * MeasuresInfo.isBeatStart() derives it internally (that method itself
 * isn't reusable here: it applies the library's own `4/denominator` beat
 * length unconditionally, which is only correct for simple time and would
 * mis-group compound time signatures — see module docs).
 */
function timeInMeasure(measuresInfo: MeasuresInfo, time: number): number {
  const measureNumber = measuresInfo.measureNumberAtQ(time);
  const measureLength = measuresInfo.measureLengthAtQ(time);
  const fractional = measureNumber - Math.floor(measureNumber);
  return fractional * measureLength;
}

/** A run of 2+ consecutive blocks that should be drawn as one merged beam. */
export interface BeamGroup {
  blocks: JianpuBlock[];
}

/**
 * Groups consecutive beamable blocks into BeamGroups, restarting at every
 * beat boundary and at every measure boundary. `blocksInOrder` must already
 * be sorted by `start` and may span multiple measures/time signatures (the
 * beat length is re-evaluated per block from `measuresInfo`).
 *
 * Only runs of 2+ blocks are returned — a single beamable block with no
 * beamable neighbour in its beat isn't a "group" a renderer needs to merge;
 * it keeps drawing its own independent underline exactly as before this
 * module existed.
 */
export function computeBeamGroups(
  blocksInOrder: JianpuBlock[],
  measuresInfo: MeasuresInfo,
): BeamGroup[] {
  const groups: BeamGroup[] = [];
  let current: JianpuBlock[] = [];

  const flush = () => {
    if (current.length >= 2) groups.push({ blocks: current });
    current = [];
  };

  for (const block of blocksInOrder) {
    const isBeamable = (block.durationLines ?? 0) >= 1 && block.notes.length > 0;
    if (!isBeamable) {
      flush();
      continue;
    }
    current.push(block);

    const timeSignature = measuresInfo.timeSignatureAtQ(block.start)
      ?? { start: 0, numerator: 4, denominator: 4 };
    const beatLength = beamBeatLengthQL(timeSignature);
    const measureLength = measuresInfo.measureLengthAtQ(block.start);
    const endInMeasure = timeInMeasure(measuresInfo, block.start) + block.length;

    const beatsFromMeasureStart = endInMeasure / beatLength;
    const atBeatBoundary = isSafeZero(beatsFromMeasureStart - Math.round(beatsFromMeasureStart));
    const atMeasureEnd = isSafeZero(endInMeasure - measureLength);
    if (atBeatBoundary || atMeasureEnd) {
      flush();
    }
  }
  flush();

  return groups;
}

/**
 * Computes, for each block in a BeamGroup, how many beam *levels* connect it
 * to the *next* block in the group (0 for the last block, which has no next
 * neighbour to connect a beam segment to). This is the standard secondary
 * ("partial"/hook) beam rule: the segment between two adjacent notes is
 * drawn at every level from 1 up to min(nBeamsOf(a), nBeamsOf(b)).
 */
export function beamLevelsBetweenConsecutiveBlocks(group: BeamGroup): number[] {
  const { blocks } = group;
  const levels: number[] = [];
  for (let i = 0; i < blocks.length - 1; i++) {
    const a = blocks[i].durationLines ?? 0;
    const b = blocks[i + 1].durationLines ?? 0;
    levels.push(Math.min(a, b));
  }
  levels.push(0);
  return levels;
}
