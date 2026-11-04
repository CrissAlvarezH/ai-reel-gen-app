// The film camera's shutter for a three.js shot: renders the scene at several sub-frame times and
// averages them in linear light (motion blur on everything, camera included), adds bloom in linear
// light, bends the picture around a shockwave, then tone maps once. Put it inside the ThreeCanvas;
// it takes over drawing.
//
//   <Shutter fr={frame} pose={(t) => shot.update(t)} samples={blurSamples(pixelSpeed(cam, frame))} />
//
// `pose(t)` must place everything that moves (objects, lights, uniforms, the camera) for a float
// frame t, as a pure function of t: the shutter calls it once per sample. Leave
// gl.toneMapping/toneMappingExposure set as usual; they are applied in the final pass, and Finish
// should then run with bloom={0}.
import React, {useEffect, useMemo} from 'react';
import {useFrame, useThree} from '@react-three/fiber';
import {CustomBlending, HalfFloatType, Mesh, OneFactor, OrthographicCamera, type PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector4, WebGLRenderTarget} from 'three';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// Samples worth spending for a picture moving `px` pixels per frame with this shutter: about one
// per 6 px of smear, between 1 and `max`. A static frame costs one render.
export const blurSamples = (px: number, shutter = 0.35, max = 10) => Math.max(1, Math.min(max, Math.ceil((px * shutter) / 6)));

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const halton = (i: number, b: number) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export type Ripple = [x: number, y: number, radius: number, amount: number]; // uv units (0..1, y up); radius in frame heights
// Soft background: objects on `layer` (and lights on every layer: light.layers.enableAll()) are
// drawn first at half size, blurred by `px` (gaussian sigma in output pixels), then everything
// else is drawn sharp over them. A cheap depth of field for a macro subject in a big place: put the
// far set, sky and distant lights on the layer. The soft layer cannot hide sharp things, so keep it
// behind them; scene.background must be null (use a sky mesh on the layer).
export type Soft = {layer: number; px: number};
const BLUR = /* glsl */ `uniform sampler2D t; uniform vec2 dir; uniform float sigma; varying vec2 vUv;
  void main() { vec3 s = vec3(0.); float w = 0.;
    for (int i = -6; i <= 6; i++) { float x = float(i) * 0.5 * sigma, k = exp(-0.5 * float(i * i) / 9.); s += texture2D(t, vUv + dir * x).rgb * k; w += k; }
    gl_FragColor = vec4(s / w, 1.); }`;

export const Shutter: React.FC<{
  fr: number;
  pose: (t: number) => void;
  samples?: number; // renders averaged per frame (1 = no motion blur)
  shutter?: number; // fraction of the frame the shutter is open: 0.25 = 90° (action, many small parts), 0.5 = 180°
  bloom?: {strength?: number; radius?: number; threshold?: number} | false;
  ripple?: Ripple | null;
  soft?: Soft | null;
  msaa?: number; // multisampling of each sample (default 4)
}> = ({fr, pose, samples = 1, shutter = 0.35, bloom = {}, ripple = null, soft = null, msaa = 4}) => {
  const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene), camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const st = useMemo(() => {
    const px = gl.getDrawingBufferSize(new Vector2());
    const sample = new WebGLRenderTarget(px.x, px.y, {type: HalfFloatType, samples: msaa});
    const accum = new WebGLRenderTarget(px.x, px.y, {type: HalfFloatType, depthBuffer: false});
    const half = [0, 1].map(() => new WebGLRenderTarget(Math.ceil(px.x / 2), Math.ceil(px.y / 2), {type: HalfFloatType}));
    const blur = new ShaderMaterial({uniforms: {t: {value: null}, dir: {value: new Vector2()}, sigma: {value: 1}}, vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false, toneMapped: false});
    const copy = new ShaderMaterial({uniforms: {t: {value: half[0].texture}}, vertexShader: VERT, fragmentShader: /* glsl */ `uniform sampler2D t; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(t, vUv).rgb, 1.); }`, depthTest: false, depthWrite: false, toneMapped: false});
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const add = new ShaderMaterial({
      uniforms: {t: {value: null}, k: {value: 1}}, vertexShader: VERT,
      // sanitised: one NaN or infinite pixel would spread through the bloom's blur into a black frame
      fragmentShader: /* glsl */ `uniform sampler2D t; uniform float k; varying vec2 vUv;
        void main() { vec3 c = texture2D(t, vUv).rgb; if (any(isnan(c)) || any(isinf(c))) c = vec3(0.); gl_FragColor = vec4(clamp(c, 0., 400.) * k, k); }`,
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneFactor, depthTest: false, depthWrite: false, toneMapped: false,
    });
    const out = new ShaderMaterial({
      uniforms: {t: {value: accum.texture}, rip: {value: new Vector4()}, aspect: {value: px.x / px.y}}, vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D t; uniform vec4 rip; uniform float aspect; varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          vec3 c;
          if (rip.w > 0.) {
            vec2 d = (uv - rip.xy) * vec2(aspect, 1.); float r = length(d);
            float k = rip.w * exp(-pow((r - rip.z) / max(0.02, rip.z * 0.18), 2.));
            vec2 dir = d / max(r, 1e-4) / vec2(aspect, 1.);
            // refraction at the front, with a slight colour split
            c = vec3(texture2D(t, uv - dir * k * 1.15).r, texture2D(t, uv - dir * k).g, texture2D(t, uv - dir * k * 0.85).b);
          } else c = texture2D(t, uv).rgb;
          gl_FragColor = vec4(c, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), add), qs = new Scene();
    quad.frustumCulled = false;
    qs.add(quad);
    const b = bloom ? new UnrealBloomPass(px.clone(), bloom.strength ?? 0.6, bloom.radius ?? 0.5, bloom.threshold ?? 1.0) : null;
    return {sample, accum, half, blur, copy, cam, add, out, quad, qs, bloom: b, px};
  }, [gl, size.width, size.height, msaa, bloom === false]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { [st.sample, st.accum, ...st.half].forEach((t) => t.dispose()); st.bloom?.dispose(); }, [st]);
  useEffect(() => { gl.shadowMap.autoUpdate = false; return () => { gl.shadowMap.autoUpdate = true; }; }, [gl]);

  // a full-screen pass that draws over its target without clearing it (the accumulation adds up)
  const pass = (m: ShaderMaterial, target: WebGLRenderTarget | null) => {
    const ac = gl.autoClear;
    st.quad.material = m; gl.setRenderTarget(target); gl.autoClear = false; gl.render(st.qs, st.cam); gl.autoClear = ac;
  };
  useFrame(() => {
    const n = Math.max(1, Math.round(samples)), W = st.px.x, H = st.px.y;
    gl.setRenderTarget(st.accum);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, false, false);
    for (let i = 0; i < n; i++) {
      // centred shutter: samples spread over [fr - shutter/2, fr + shutter/2]
      pose(n === 1 ? fr : fr + shutter * ((i + 0.5) / n - 0.5));
      if (i === 0) gl.shadowMap.needsUpdate = true; // shadows once per frame, at the first sample
      if (n > 1) camera.setViewOffset(W, H, halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5, W, H); // sub-pixel jitter: free supersampling
      gl.setClearColor(0x000000, 1);
      if (soft) {
        camera.layers.set(soft.layer);
        gl.setRenderTarget(st.half[0]); gl.clear(); gl.render(scene, camera);
        const [a, b] = st.half, sg = soft.px / 2; // sigma in half-size texels
        st.blur.uniforms.sigma.value = sg;
        st.blur.uniforms.t.value = a.texture; st.blur.uniforms.dir.value.set(1 / a.width, 0); pass(st.blur, b);
        st.blur.uniforms.t.value = b.texture; st.blur.uniforms.dir.value.set(0, 1 / a.height); pass(st.blur, a);
        camera.layers.enableAll(); camera.layers.disable(soft.layer);
        gl.setRenderTarget(st.sample); gl.clear();
        pass(st.copy, st.sample);
        gl.clearDepth();
        const ac = gl.autoClear; gl.autoClear = false;
        gl.render(scene, camera);
        gl.autoClear = ac;
        camera.layers.enableAll();
      } else {
        gl.setRenderTarget(st.sample);
        gl.clear();
        gl.render(scene, camera);
      }
      if (n > 1) camera.clearViewOffset();
      st.add.uniforms.t.value = st.sample.texture;
      st.add.uniforms.k.value = 1 / n;
      pass(st.add, st.accum);
    }
    if (st.bloom && bloom) {
      st.bloom.strength = bloom.strength ?? 0.6; st.bloom.radius = bloom.radius ?? 0.5; st.bloom.threshold = bloom.threshold ?? 1.0;
      st.bloom.render(gl, null as never, st.accum, 0, false);
    }
    st.out.uniforms.rip.value.set(...(ripple ?? [0, 0, 0, 0]));
    pass(st.out, null);
  }, 1);
  return null;
};
