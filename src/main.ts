import { App } from './ui/app';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || Math.floor(Math.random() * 100000) + 1;

// ?quality=low turns off shadows and antialiasing; ?instant=1 skips animation.
const app = new App({ lowQuality: params.get('quality') === 'low', instant: params.get('instant') === '1' });
app.start(seed);

// Exposed for debugging in the console.
(window as unknown as { foothold: App }).foothold = app;
