// The thumbnail's own entry (./thumb.sh → out/miniatura.png), apart from the film's src/Root.tsx: changing the cover
// never makes Reel Studio think the render is out of date. Load here the fonts Thumbnail.tsx uses.
import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {loadFont as inter} from '@remotion/google-fonts/Inter';
import {Thumbnail} from './Thumbnail';
import {FPS, H, W} from '../lib';

inter('normal', {weights: ['400', '500', '700', '800'], subsets: ['latin']});

registerRoot(() => <Composition id="Thumbnail" component={Thumbnail} width={W} height={H} fps={FPS} durationInFrames={1} />);
