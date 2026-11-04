// Three collage test scenes: interview, server + phones, neural network.
import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, Cutout, Dots, FONT, Highlight, Paper, Torn} from '../collage/kit';

// on twos-and-a-half: 12 fps stutter
const useStep = () => Math.floor(useCurrentFrame() / 2.5) * 2.5;
const useDrop = (at: number) => {
  const f = useStep(); const {fps} = useVideoConfig();
  return spring({frame: f - at, fps, config: {damping: 11, stiffness: 140, mass: 0.8}});
};
// a piece that drops onto the board: falls from above, overshoots, settles; shadow shrinks as it lands
const Drop: React.FC<{at: number; dy?: number; rot?: number; children: React.ReactNode}> = ({at, dy = -120, rot = 6, children}) => {
  const p = useDrop(at);
  return <div style={{position: 'absolute', inset: 0, opacity: p > 0.01 ? 1 : 0,
    transform: `translateY(${(1 - p) * dy}px) rotate(${(1 - p) * rot}deg) scale(${1 + (1 - p) * 0.08})`}}>{children}</div>;
};
const typed = (s: string, at: number, f: number, cps = 26) => s.slice(0, Math.max(0, Math.floor((f - at) / 30 * cps)));
const Title: React.FC<{text: string; at?: number; w?: number}> = ({text, at = 0, w = 760}) => (
  <Drop at={at} dy={-60} rot={-4}>
    <Torn x={60} y={130} w={w} h={124} seed={7} rot={-3} fill={C.ink}>
      <div style={{fontFamily: FONT.head, color: C.white, fontSize: 82, lineHeight: '124px', paddingLeft: 30, whiteSpace: 'nowrap'}}>{text}</div>
    </Torn>
  </Drop>
);

// 1. Interview
export const DemoInterview: React.FC = () => {
  const f = useStep();
  const q = '¿Cómo proteges los datos de tus usuarios?';
  const a = 'Verifico en cada petición que el dato sea suyo.';
  return (
    <AbsoluteFill><Paper />
      <Drop at={2} dy={0} rot={0}><div style={{position: 'absolute', left: 120, top: 760, width: 840, height: 840, borderRadius: '50%', background: C.red}} /></Drop>
      <Drop at={4} dy={0} rot={0}><Dots w={460} h={460} size={14} style={{left: -80, top: 1380, borderRadius: '50%'}} /></Drop>
      <Title text="LA ENTREVISTA" at={0} w={640} />
      <Drop at={8} dy={160} rot={-8}><Cutout src="cut/woman.png" x={-40} y={1010} w={600} rot={2} lift={1.8} /></Drop>
      <Drop at={14} dy={160} rot={8}><Cutout src="cut/man.png" x={560} y={980} w={540} rot={-2} lift={1.8} /></Drop>
      {/* desk strip across the bottom */}
      <Drop at={18} dy={80} rot={0}><Torn x={-30} y={1720} w={1140} h={260} seed={21} fill={C.ink} /></Drop>
      <Drop at={30} dy={-80} rot={-10}>
        <Torn x={70} y={380} w={620} h={250} seed={31} rot={-4} lift={1.6}>
          <div style={{padding: '30px 36px', fontFamily: FONT.type, fontSize: 44, color: C.ink, lineHeight: 1.3}}>{typed(q, 36, f)}</div>
        </Torn>
        <svg style={{position: 'absolute', inset: 0, overflow: 'visible'}} width="100%" height="100%"><polygon points="250,600 330,610 220,760" fill={C.white} /></svg>
      </Drop>
      <Drop at={80} dy={-80} rot={10}>
        <Torn x={400} y={640} w={620} h={250} seed={33} rot={3} lift={1.6} fill={C.yellow}>
          <div style={{padding: '30px 36px', fontFamily: FONT.type, fontSize: 44, color: C.ink, lineHeight: 1.3}}>{typed(a, 86, f)}</div>
        </Torn>
        <svg style={{position: 'absolute', inset: 0, overflow: 'visible'}} width="100%" height="100%"><polygon points="760,870 850,880 860,1010" fill={C.yellow} /></svg>
      </Drop>
    </AbsoluteFill>
  );
};

// 2. One server, three phones sending requests
const PHONES = [
  {src: 'cut/phone_hand.png', x: -30, y: 1330, w: 380, rot: 12, path: 'M 170 1400 C 160 1100, 300 900, 430 780', req: 'GET /facturas/1042'},
  {src: 'cut/phone2.png', x: 330, y: 1500, w: 420, rot: -4, path: 'M 540 1520 C 560 1300, 520 1050, 540 860', req: 'POST /pagos'},
  {src: 'cut/phone3.png', x: 700, y: 1330, w: 420, rot: -14, path: 'M 880 1380 C 920 1100, 800 900, 650 790', req: 'GET /perfil'},
];
const Packet: React.FC<{d: string; t: number; label: string}> = ({d, t, label}) => {
  if (t <= 0 || t >= 1) return null;
  // sample the path in the browser
  const el = React.useMemo(() => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); return p; }, [d]);
  const L = el.getTotalLength(); const pt = el.getPointAtLength(L * t);
  return (
    <div style={{position: 'absolute', left: pt.x - 150, top: pt.y - 34, transform: `rotate(${(t - 0.5) * 10}deg)`}}>
      <Torn x={0} y={0} w={300} h={68} seed={Math.round(pt.x)} fill={C.yellow} lift={1.4}>
        <div style={{fontFamily: FONT.type, fontSize: 30, lineHeight: '68px', textAlign: 'center', color: C.ink, whiteSpace: 'nowrap'}}>{label}</div>
      </Torn>
    </div>
  );
};
export const DemoServer: React.FC = () => {
  const f = useStep();
  const hits = PHONES.map((_, i) => 40 + i * 22 + 34);
  const lit = hits.some((h) => f >= h && f < h + 8);
  return (
    <AbsoluteFill><Paper />
      <Drop at={2} dy={0} rot={0}><div style={{position: 'absolute', left: 230, top: 330, width: 620, height: 620, borderRadius: '50%', background: C.ink}} /></Drop>
      <Drop at={3} dy={0} rot={0}><Dots w={620} h={620} size={16} color={C.paper} style={{left: 230, top: 330, borderRadius: '50%', opacity: 0.35}} /></Drop>
      <Title text="1 SERVIDOR, 3 CELULARES" at={0} w={960} />
      <Drop at={6} dy={-200} rot={-5}><Cutout src="cut/rack.png" x={410} y={300} w={270} rot={-2} lift={2} /></Drop>
      {lit && <div style={{position: 'absolute', left: 470, top: 640, width: 150, height: 110, background: C.yellow, mixBlendMode: 'multiply', transform: 'rotate(-2deg)'}} />}
      {PHONES.map((p, i) => <Drop key={i} at={12 + i * 5} dy={200} rot={p.rot}><Cutout src={p.src} x={p.x} y={p.y} w={p.w} rot={p.rot} lift={1.8} /></Drop>)}
      <svg style={{position: 'absolute', inset: 0}} width={1080} height={1920}>
        {PHONES.map((p, i) => <path key={i} d={p.path} fill="none" stroke={C.ink} strokeWidth={5} strokeDasharray="4 18" strokeLinecap="round"
          opacity={interpolate(f, [30 + i * 6, 40 + i * 6], [0, 0.9], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})} />)}
      </svg>
      {PHONES.map((p, i) => <Packet key={i} d={p.path} label={p.req} t={interpolate(f, [40 + i * 22, 74 + i * 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})} />)}
      {f >= 75 && <Drop at={75} dy={-40} rot={-12}><div style={{position: 'absolute', left: 690, top: 520, transform: 'rotate(-12deg)', border: `7px solid ${C.red}`, color: C.red,
        fontFamily: FONT.head, fontSize: 60, padding: '0 18px', letterSpacing: 2, mixBlendMode: 'multiply'}}>¿DE QUIÉN?</div></Drop>}
    </AbsoluteFill>
  );
};

// 3. Neural network passing weights between neurons (signal flows dendrites -> axon, top -> bottom)
const N1 = [{src: 'cut/neuronC.png', x: 40}, {src: 'cut/neuronD.png', x: 380}, {src: 'cut/neuronC.png', x: 760}];
const N2 = [{src: 'cut/neuronD.png', x: 160}, {src: 'cut/neuronC.png', x: 640}];
const AX1 = [{x: 175, y: 930}, {x: 515, y: 930}, {x: 895, y: 930}]; // axon tips row 1
const DEN2 = [{x: 300, y: 1290}, {x: 775, y: 1290}]; // dendrite tops row 2
const W = [[0.82, -0.31], [0.47, 0.66], [-0.12, 0.91]];
export const DemoNeural: React.FC = () => {
  const f = useStep();
  return (
    <AbsoluteFill><Paper />
      <Title text="PESOS QUE VIAJAN" at={0} w={720} />
      <Drop at={2} dy={0} rot={0}><Dots w={1080} h={340} size={14} style={{left: 0, top: 940, opacity: 0.25}} /></Drop>
      {N1.map((n, i) => <Drop key={i} at={4 + i * 4} dy={-160} rot={-6}><Cutout src={n.src} x={n.x} y={330} w={270} lift={1.4} /></Drop>)}
      {N2.map((n, i) => <Drop key={i} at={18 + i * 4} dy={160} rot={6}><Cutout src={n.src} x={n.x} y={1280} w={270} lift={1.4} /></Drop>)}
      <svg style={{position: 'absolute', inset: 0, overflow: 'visible'}} width={1080} height={1920}>
        {AX1.map((a, i) => DEN2.map((d, j) => {
          const p = interpolate(f, [30 + i * 4, 44 + i * 4], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          return <path key={`${i}${j}`} d={`M ${a.x} ${a.y} C ${a.x} ${a.y + 120}, ${d.x} ${d.y - 140}, ${d.x} ${d.y}`} fill="none"
            stroke={C.ink} strokeWidth={Math.abs(W[i][j]) * 9 + 2} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />;
        }))}
        {/* parameters travelling as yellow dots */}
        {AX1.map((a, i) => DEN2.map((d, j) => {
          const t = interpolate(f, [60 + i * 6, 96 + i * 6], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          if (t <= 0 || t >= 1) return null;
          const u = 1 - t; const x = u ** 3 * a.x + 3 * u * u * t * a.x + 3 * u * t * t * d.x + t ** 3 * d.x;
          const y = u ** 3 * a.y + 3 * u * u * t * (a.y + 120) + 3 * u * t * t * (d.y - 140) + t ** 3 * d.y;
          return <circle key={`p${i}${j}`} cx={x} cy={y} r={22} fill={C.yellow} stroke={C.ink} strokeWidth={4} />;
        }))}
      </svg>
      {AX1.map((a, i) => DEN2.map((d, j) => {
        const t = 0.22 + 0.28 * i, u = 1 - t;
        const mx = u ** 3 * a.x + 3 * u * u * t * a.x + 3 * u * t * t * d.x + t ** 3 * d.x + (j ? 60 : -60);
        const my = u ** 3 * a.y + 3 * u * u * t * (a.y + 120) + 3 * u * t * t * (d.y - 140) + t ** 3 * d.y;
        return <Drop key={`w${i}${j}`} at={46 + (i * 2 + j) * 3} dy={-50} rot={8}>
          <Torn x={mx - 70} y={my - 26} w={140} h={52} seed={i * 5 + j + 40} rot={(i - j) * 4} fill={W[i][j] < 0 ? C.red : C.white}>
            <div style={{fontFamily: FONT.type, fontSize: 30, lineHeight: '52px', textAlign: 'center', color: W[i][j] < 0 ? C.white : C.ink}}>w {W[i][j].toFixed(2)}</div>
          </Torn></Drop>;
      }))}
      <Drop at={104} dy={120} rot={-6}>
        <Torn x={300} y={1780} w={480} h={110} seed={77} rot={-2} lift={1.8}>
          <div style={{fontFamily: FONT.type, fontSize: 46, lineHeight: '110px', textAlign: 'center', color: C.ink}}>salida: <Highlight><b>0.91</b></Highlight></div>
        </Torn>
      </Drop>
    </AbsoluteFill>
  );
};
