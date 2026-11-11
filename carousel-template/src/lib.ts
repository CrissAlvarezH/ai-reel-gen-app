import React from 'react';
import carousel from '../carousel.json';

// carousel.json is the carousel: its size (4:5, 1080×1350 by default) and its slides, in order. Each slide has a
// stable id (a-z, 0-9 and dashes) that never changes when it moves, its title and the text it shows (the copy,
// read by Reel Studio's audit and by the agent: keep it the same as what the slide says). Its picture is the
// component in src/slides/<id>.tsx (default export). Reel Studio may reorder, add or duplicate slides here.
export type SlideEntry = {id: string; title: string; text?: string; notes?: string};
export type Carousel = {width: number; height: number; slides: SlideEntry[]};
export const CAROUSEL = carousel as Carousel;
export const W = CAROUSEL.width || 1080;
export const H = CAROUSEL.height || 1350;
export const SLIDES = CAROUSEL.slides;

// What every slide component gets: its id, where it is (0-based) and how many there are, and its entry's title and text.
export type SlideProps = {id: string; index: number; total: number; title: string; text: string};

// Every src/slides/<id>.tsx, found by the bundler: a new or duplicated slide needs no list to keep in sync.
declare const require: {context(dir: string, deep: boolean, re: RegExp): {keys(): string[]; (k: string): {default?: React.FC<SlideProps>}}};
const files = require.context('./slides', false, /\.tsx$/);
const byId = new Map(files.keys().map((k) => [k.replace(/^\.\//, '').replace(/\.tsx$/, ''), files(k).default]));

const Missing: React.FC<SlideProps> = ({id, index, total}) =>
  React.createElement(
    'div',
    {style: {width: W, height: H, background: '#1C1C1E', color: '#F5F5F5', display: 'grid', placeItems: 'center', fontFamily: 'Inter, sans-serif', fontSize: 48, textAlign: 'center', padding: 80}},
    `Lámina ${index + 1}/${total}: falta src/slides/${id}.tsx`,
  );
export const slideComponent = (id: string): React.FC<SlideProps> => byId.get(id) ?? Missing;

// Instagram crops a 4:5 post to a 3:4 tile in the profile grid and puts its own UI on the edges: keep text inside
// the safe area (SAFE px from each side).
export const SAFE = 72;
