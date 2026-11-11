// The carousel as one Remotion composition: one frame per slide, in the order of carousel.json. ./render.sh renders
// every frame to a PNG (a new version in out/vN/); ./preview.sh renders some of them to look at while working.
// Load here the fonts the slides use (the style's, styles/<id>/style.json).
import React from 'react';
import {AbsoluteFill, Composition, useCurrentFrame} from 'remotion';
import {loadFont as inter} from '@remotion/google-fonts/Inter';
import {CAROUSEL, H, SLIDES, W, slideComponent} from './lib';

inter('normal', {weights: ['400', '500', '700', '800'], subsets: ['latin']});

const Carousel: React.FC = () => {
  const i = useCurrentFrame();
  const slide = SLIDES[i];
  if (!slide) return <AbsoluteFill style={{background: '#111'}} />;
  const Slide = slideComponent(slide.id);
  return <Slide id={slide.id} index={i} total={SLIDES.length} title={slide.title} text={slide.text ?? ''} />;
};

export const Root: React.FC = () => (
  <Composition id="Carousel" component={Carousel} width={W} height={H} fps={1} durationInFrames={Math.max(1, CAROUSEL.slides.length)} />
);
