import React from 'react';
import {Composition} from 'remotion';
import {loadFont as inter} from '@remotion/google-fonts/Inter';
import {loadFont as anton} from '@remotion/google-fonts/Anton';
import {loadFont as elite} from '@remotion/google-fonts/SpecialElite';
import {loadFont as marker} from '@remotion/google-fonts/PermanentMarker';
import {Film} from './film/Film';
import {FPS, H, TOTAL, W} from './lib';

inter('normal', {weights: ['400', '700', '800'], subsets: ['latin']});
anton(); elite(); marker();

// audio=false until public/mix.wav exists (audio/mix.py builds it from public/vo.wav)
export const Root: React.FC = () => (
  <Composition id="Film" component={Film} width={W} height={H} fps={FPS} durationInFrames={TOTAL} defaultProps={{audio: false}} />
);
