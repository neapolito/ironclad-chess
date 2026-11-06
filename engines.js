/*  Engine manager: one interface over every engine.
    - Stockfish 10 (asm.js build, loaded from cdnjs, runs in your browser)
    - Ironclad (IronForge's own engine, runs offline in a Web Worker)
    Lines are always reported with scores from WHITE's point of view.         */
(function (root) {
  const STOCKFISH_URL = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';

  const ENGINES = {
    stockfish: { id: 'stockfish', name: 'Stockfish 10', tag: 'STRONGEST', desc: 'World-class engine, runs in your browser (downloads ~1 MB once).' },
    ironclad: { id: 'ironclad', name: 'Ironclad', tag: 'BUILT-IN', desc: "IronForge's own alpha-beta engine. Works offline." },
    ironclad_lite: { id: 'ironclad_lite', name: 'Ironclad Lite', tag: 'FAST', desc: 'Quick shallow search — instant hints on slow devices.' },
  };

  function toWhite(score, turn) {
    if (!score) return score;
    const s = turn === 'w' ? 1 : -1;
    return score.mate !== undefined ? { mate: score.mate * s } : { cp: score.cp * s };
  }

  /* ---------------- Ironclad (built-in worker) ---------------- */
  class Ironclad {
    constructor(lite) { this.lite = lite; this.worker = null; this.busy = null; }
    _spawn() { this.worker = new Worker('js/engine-worker.js'); }
    stop() {
      if (this.worker) this.worker.terminate();
      this.worker = null;
      if (this.busy) { this.busy.reject(new Error('stopped')); this.busy = null; }
    }
    analyze({ fen, history, movetime, depth, multipv, noise, blunder }, onInfo) {
      this.stop();
      this._spawn();
      const turn = fen.split(' ')[1];
      return new Promise((resolve, reject) => {
        this.busy = { resolve, reject };
        this.worker.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'info' && onInfo) onInfo({ depth: m.depth, nodes: m.nodes, lines: m.lines.map((l) => ({ score: toWhite(l.score, turn), pv: l.pv })) });
          if (m.type === 'bestmove') { this.busy = null; resolve({ move: m.move, score: toWhite(m.score, turn) }); }
          if (m.type === 'error') { this.busy = null; reject(new Error(m.error)); }
        };
        this.worker.onerror = (e) => { this.busy = null; reject(new Error(e.message || 'engine worker failed')); };
        this.worker.postMessage({
          cmd: 'go', fen, history, multipv,
          movetime: this.lite ? Math.min(movetime || 400, 400) : (movetime || 2500),
          depth: this.lite ? Math.min(depth || 4, 4) : depth, noise, blunder,
        });
      });
    }
  }

  /* ---------------- Stockfish (UCI over a blob worker) ---------------- */
  class Stockfish {
    constructor() { this.worker = null; this.ready = null; this.listeners = []; this.current = null; }
    load() {
      if (this.ready) return this.ready;
      this.ready = new Promise((resolve, reject) => {
        let blobUrl;
        try {
          blobUrl = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(STOCKFISH_URL)});`], { type: 'application/javascript' }));
          this.worker = new Worker(blobUrl);
        } catch (e) { reject(e); return; }
        const timer = setTimeout(() => reject(new Error('Stockfish did not load (offline or blocked).')), 20000);
        this.worker.onerror = (e) => { clearTimeout(timer); reject(new Error('Stockfish failed to load: ' + (e.message || 'network error'))); };
        this.worker.onmessage = (e) => {
          const line = typeof e.data === 'string' ? e.data : '';
          if (line === 'uciok') { clearTimeout(timer); this.send('isready'); }
          if (line === 'readyok' && !this._ok) { this._ok = true; resolve(this); }
          this.listeners.forEach((fn) => fn(line));
        };
        this.send('uci');
      });
      this.ready.catch(() => { this.ready = null; this._ok = false; if (this.worker) this.worker.terminate(); this.worker = null; });
      return this.ready;
    }
    send(cmd) { if (this.worker) this.worker.postMessage(cmd); }
    stop() {
      if (this.current) { this.send('stop'); }
    }
    async analyze({ fen, movetime, depth, multipv, skill }, onInfo) {
      await this.load();
      // finish any running search first
      if (this.current) { this.send('stop'); await this.current.done.catch(() => {}); }
      const turn = fen.split(' ')[1];
      const lines = [];
      let lastDepth = 0;
      let resolveFn, rejectFn;
      const done = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });
      const handler = (line) => {
        if (line.startsWith('info') && line.includes(' pv ') && line.includes('score')) {
          const d = +((line.match(/ depth (\d+)/) || [])[1] || 0);
          const k = +((line.match(/ multipv (\d+)/) || [])[1] || 1);
          const sm = line.match(/ score (cp|mate) (-?\d+)/);
          const pv = line.split(' pv ')[1].trim().split(/\s+/);
          if (!sm) return;
          const score = sm[1] === 'cp' ? { cp: +sm[2] } : { mate: +sm[2] };
          if (line.includes('lowerbound') || line.includes('upperbound')) return;
          lines[k - 1] = { score: toWhite(score, turn), pv };
          if (k === (multipv || 1) || d > lastDepth) {
            lastDepth = d;
            if (onInfo) onInfo({ depth: d, lines: lines.filter(Boolean).slice(0, multipv || 1) });
          }
        } else if (line.startsWith('bestmove')) {
          this.listeners = this.listeners.filter((f) => f !== handler);
          this.current = null;
          const mv = line.split(' ')[1];
          resolveFn({ move: mv === '(none)' ? null : mv, score: lines[0] && lines[0].score });
        }
      };
      this.listeners.push(handler);
      this.current = { done };
      this.send('setoption name MultiPV value ' + (multipv || 1));
      this.send('setoption name Skill Level value ' + (skill === undefined ? 20 : skill));
      this.send('position fen ' + fen);
      this.send(depth ? `go depth ${depth}` : `go movetime ${movetime || 2500}`);
      return done;
    }
  }

  const instances = {};
  function get(id) {
    if (!instances[id]) instances[id] = id === 'stockfish' ? new Stockfish() : new Ironclad(id === 'ironclad_lite');
    return instances[id];
  }

  /** Analyze with fallback: if Stockfish can't load, use Ironclad and tell the caller. */
  async function analyze(id, params, onInfo) {
    try {
      const r = await get(id).analyze(params, onInfo);
      r.engine = id;
      return r;
    } catch (e) {
      if (id === 'stockfish' && e.message !== 'stopped') {
        root.dispatchEvent(new CustomEvent('engine-fallback', { detail: e.message }));
        const r = await get('ironclad').analyze(params, onInfo);
        r.engine = 'ironclad';
        return r;
      }
      throw e;
    }
  }

  function stopAll() { Object.values(instances).forEach((e) => e.stop()); }

  /* ---------------- Bots ---------------- */
  const BOTS = [
    { id: 'pete', name: 'Pawnstorm Pete', elo: '~500', engine: 'ironclad', depth: 1, movetime: 300, noise: 260, blunder: 0.22, blurb: 'Pushes pawns, hangs pieces, has fun.', color: '#7aa344' },
    { id: 'sal', name: 'Scrapyard Sal', elo: '~800', engine: 'ironclad', depth: 2, movetime: 500, noise: 140, blunder: 0.1, blurb: 'Builds attacks out of spare parts.', color: '#b8862f' },
    { id: 'frank', name: 'Foreman Frank', elo: '~1100', engine: 'ironclad', depth: 3, movetime: 800, noise: 60, blunder: 0.04, blurb: 'Solid, practical, punishes loose pieces.', color: '#c9662b' },
    { id: 'ironjaw', name: 'Iron Jaw', elo: '~1500', engine: 'ironclad', movetime: 1500, noise: 20, blurb: 'Tactically sharp. Will not let you breathe.', color: '#8a8f96' },
    { id: 'furnace', name: 'The Furnace', elo: '~1800', engine: 'ironclad', movetime: 3000, blurb: 'Ironclad at full heat.', color: '#d9461f' },
    { id: 'sf5', name: 'Stockfish · Level 5', elo: '~1700', engine: 'stockfish', skill: 5, movetime: 800, blurb: 'Stockfish with the brakes on.', color: '#3d7fbf' },
    { id: 'sf12', name: 'Stockfish · Level 12', elo: '~2200', engine: 'stockfish', skill: 12, movetime: 1200, blurb: 'Club-master strength.', color: '#2c5f99' },
    { id: 'sf20', name: 'Stockfish · Max', elo: '3000+', engine: 'stockfish', skill: 20, movetime: 2000, blurb: 'Full strength. Good luck.', color: '#1b3d66' },
  ];

  root.Engines = { ENGINES, BOTS, get, analyze, stopAll, toWhite };
})(window);
