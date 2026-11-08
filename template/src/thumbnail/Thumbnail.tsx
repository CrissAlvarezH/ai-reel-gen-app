// The video's thumbnail (its cover): replace this placeholder with the one its style asks for (style.json
// "thumbnail"). It can use the film's own components and props from ../film.
import React from 'react';
import {AbsoluteFill} from 'remotion';

export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{background: '#111111', color: '#F5F5F5', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 96, alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 80}}>
    Miniatura pendiente
  </AbsoluteFill>
);
