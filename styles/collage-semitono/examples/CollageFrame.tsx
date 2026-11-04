// Style frame: "Cambio un número: 1043 … Es de otra persona." in halftone paper collage.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Arrow, C, Cutout, Dots, FONT, Highlight, MarkerCircle, Paper, Torn} from '../collage/kit';

const PH = {w: 860, x: 150, y: 330, rot: -5}; // hand+phone cutout (1752x2375 source)
const k = PH.w / 1752;
const SCR = {x: 728 * k, y: 136 * k, w: 866 * k, h: 1768 * k};

export const CollageFrame: React.FC = () => (
  <AbsoluteFill style={{background: C.paper}}>
    <Paper />
    {/* backing shapes */}
    <div style={{position: 'absolute', left: 430, top: 300, width: 640, height: 640, borderRadius: '50%', background: C.red, transform: 'rotate(8deg)'}} />
    <Dots w={520} h={520} size={14} style={{left: 40, top: 1040, borderRadius: '50%', opacity: 0.85}} />
    <Torn x={60} y={150} w={700} h={120} seed={7} rot={-3} fill={C.ink}>
      <div style={{fontFamily: FONT.head, color: C.white, fontSize: 84, lineHeight: '120px', paddingLeft: 30, letterSpacing: 1, whiteSpace: 'nowrap'}}>CAMBIO UN NÚMERO</div>
    </Torn>
    {/* hand + phone, screen UI rides with it */}
    <div style={{position: 'absolute', left: PH.x, top: PH.y, width: PH.w, transform: `rotate(${PH.rot}deg)`}}>
      <Cutout src="cut/phone_hand.png" x={0} y={0} w={PH.w} lift={1.6} />
      <div style={{position: 'absolute', left: SCR.x, top: SCR.y, width: SCR.w, height: SCR.h, background: '#F4F1EA', borderRadius: 26, overflow: 'hidden', padding: '34px 22px', boxSizing: 'border-box'}}>
        <div style={{fontFamily: FONT.sans, fontSize: 20, color: '#555', marginBottom: 14}}>sesión: <Highlight><b style={{color: C.ink}}>Ana</b></Highlight></div>
        <div style={{position: 'relative', background: C.white, border: `3px solid ${C.ink}`, borderRadius: 12, padding: '14px 14px', fontFamily: FONT.type, fontSize: 30, color: C.ink, whiteSpace: 'nowrap'}}>
          /facturas/104<span style={{position: 'relative', color: C.red, fontSize: 44, fontWeight: 700}}>3
            <svg style={{position: 'absolute', left: -30, top: -26, width: 90, height: 100, overflow: 'visible'}}><MarkerCircle cx={42} cy={50} rx={34} ry={40} width={6} /></svg></span>
        </div>
        <div style={{marginTop: 30, fontFamily: FONT.type, color: C.ink, fontSize: 24, lineHeight: 1.6}}>
          <div style={{fontFamily: FONT.head, fontSize: 46}}>FACTURA #1043</div>
          <div>Cliente: Laura Gómez</div>
          <div>NIT 900.481.227-3</div>
          <div>Total $4.870.000</div>
        </div>
        <Dots w={400} h={300} size={9} color="#bbb" style={{left: 22, top: 420, opacity: 0.5}} />
      </div>
    </div>
    {/* the leaked invoice tearing out of the screen */}
    <Torn x={560} y={1030} w={460} h={330} seed={12} rot={9} lift={2.2}>
      <div style={{padding: '30px 34px', fontFamily: FONT.type, color: C.ink, fontSize: 30, lineHeight: 1.45}}>
        <div style={{fontFamily: FONT.head, fontSize: 54, lineHeight: 1.1}}>Laura Gómez</div>
        <div>Cra 7 # 71-21</div>
        <div>$4.870.000</div>
      </div>
      <div style={{position: 'absolute', right: 20, bottom: 26, transform: 'rotate(-14deg)', border: `6px solid ${C.red}`, color: C.red,
        fontFamily: FONT.head, fontSize: 46, padding: '2px 16px', letterSpacing: 2, opacity: 0.9, mixBlendMode: 'multiply'}}>NO ES TUYA</div>
    </Torn>
    
    {/* caption on a strip of tape */}
    <Torn x={110} y={1580} w={860} h={130} seed={3} rot={-1.5}>
      <div style={{fontFamily: FONT.sans, fontWeight: 800, fontSize: 56, color: C.ink, textAlign: 'center', lineHeight: '130px'}}>Es de otra persona.</div>
    </Torn>
  </AbsoluteFill>
);
