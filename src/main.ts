import { Assets } from './render/assets';
import { App } from './ui/app';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || Math.floor(Math.random() * 100000) + 1;

// ?quality=low turns off shadows and antialiasing; ?instant=1 skips animation;
// ?models=0 draws everything from primitives, without the Kenney models.
const app = new App({ lowQuality: params.get('quality') === 'low', instant: params.get('instant') === '1' });

async function boot() {
  if (params.get('models') !== '0') {
    const modal = document.getElementById('modal')!;
    modal.hidden = false;
    modal.innerHTML = '<div class="mbox"><div class="kicker">Foothold</div><h2>Landing…</h2><p class="muted" id="loadmsg">Loading models</p></div>';
    const assets = new Assets();
    await assets.loadAll((done, total) => {
      const el = document.getElementById('loadmsg');
      if (el) el.textContent = `Loading models ${done} / ${total}`;
    });
    app.scene.assets = assets;
  }
  app.start(seed);
}

void boot();

// Exposed for debugging in the console.
(window as unknown as { foothold: App }).foothold = app;
