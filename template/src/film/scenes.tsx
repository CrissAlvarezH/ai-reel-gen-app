// One scene per act. Each gets the absolute frame (already drawn at 12 fps). Replace with the film's acts.
import React from 'react';
import {C, Cutout, FONT, MarkerCircle, Torn} from '../collage/kit';
import {ACTS, f, H, W} from '../lib';
import {at, Drop, p01, Stamp, TitleStrip} from './stage';

type S = React.FC<{fr: number}>;
const A = (k: keyof typeof ACTS) => f(ACTS[k][0]);

export const Hook: S = ({fr}) => <>
  <Drop fr={fr} at={2} dy={0} rot={0}><div style={{position: 'absolute', left: 190, top: 520, width: 700, height: 700, borderRadius: '50%', background: C.yellow}} /></Drop>
  <TitleStrip text="TU HISTORIA" fr={fr} at={4} w={560} />
  <Drop fr={fr} at={at('empieza')} dy={-160} rot={-10}>
    <Torn x={170} y={760} w={740} h={220} seed={4} rot={-3} lift={1.8}>
      <div style={{fontFamily: FONT.head, fontSize: 120, lineHeight: '220px', textAlign: 'center', color: C.ink}}>AQUÍ</div></Torn></Drop>
  {fr >= at('aquí') && <svg style={{position: 'absolute', inset: 0, overflow: 'visible'}} width={W} height={H}>
    <MarkerCircle cx={540} cy={870} rx={420} ry={170} p={p01(fr, at('aquí'), 8)} width={10} /></svg>}
</>;

export const Point: S = ({fr}) => <>
  <TitleStrip text="PLANTILLA" fr={fr} at={A('point')} w={500} />
  {/* drop a cutout made with tools/cutout.py into public/cut/ and place it: */}
  {/* <Drop fr={fr} at={at('collage')} dy={300}><Cutout src="cut/phone_hand.png" x={110} y={300} w={860} rot={-5} lift={1.6} /></Drop> */}
  <Stamp fr={fr} at={at('collage')} x={540} y={1100} text="COLLAGE" size={110} />
</>;
void Cutout;
