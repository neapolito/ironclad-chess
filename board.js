/*  IronForge board widget: click or drag to move, legal-move markers, last-move
    and check highlights, promotion picker, engine arrows, coordinates, sounds. */
(function (root) {
  const FILES = 'abcdefgh';

  /* ---------- tiny synthesized sounds (no audio files needed) ---------- */
  let actx = null;
  function sound(kind) {
    if (localStorage.getItem('if_sound') === 'off') return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime;
      const len = kind === 'capture' ? 0.16 : kind === 'end' ? 0.5 : 0.09;
      const buf = actx.createBuffer(1, actx.sampleRate * len, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, kind === 'capture' ? 3 : 6);
      const src = actx.createBufferSource(); src.buffer = buf;
      const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'capture' ? 900 : kind === 'end' ? 300 : 1400;
      const g = actx.createGain(); g.gain.value = kind === 'end' ? 0.9 : 0.6;
      src.connect(f); f.connect(g); g.connect(actx.destination); src.start(t);
      if (kind === 'check' || kind === 'end') {
        const o = actx.createOscillator(), og = actx.createGain();
        o.type = 'square'; o.frequency.value = kind === 'end' ? 110 : 520;
        og.gain.setValueAtTime(0.08, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        o.connect(og); og.connect(actx.destination); o.start(t); o.stop(t + 0.3);
      }
    } catch (e) { /* audio not available */ }
  }

  class Board {
    constructor(el, opts) {
      this.el = el;
      this.opts = Object.assign({ orientation: 'w', movable: () => true, onMove: () => true, coords: true }, opts || {});
      this.orientation = this.opts.orientation;
      this.chess = null;
      this.selected = null;
      this.arrows = [];
      this.lastMove = null;
      this.el.classList.add('if-board');
      this.el.innerHTML = '<div class="if-squares"></div><svg class="if-arrows" viewBox="0 0 8 8" preserveAspectRatio="none"></svg><div class="if-promo hidden"></div>';
      this.sqLayer = this.el.querySelector('.if-squares');
      this.arrowLayer = this.el.querySelector('.if-arrows');
      this.promoLayer = this.el.querySelector('.if-promo');
      this._build();
      this._bindPointer();
    }

    get pieceStyle() { return localStorage.getItem('if_pieces') || 'classic'; }

    _build() {
      this.squares = {};
      this.sqLayer.innerHTML = '';
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const file = this.orientation === 'w' ? f : 7 - f;
          const rank = this.orientation === 'w' ? 7 - r : r;
          const name = FILES[file] + (rank + 1);
          const d = document.createElement('div');
          d.className = 'if-sq ' + ((file + rank) % 2 ? 'light' : 'dark');
          d.dataset.sq = name;
          if (this.opts.coords) {
            if (f === 0) d.insertAdjacentHTML('beforeend', `<span class="coord rank">${rank + 1}</span>`);
            if (r === 7) d.insertAdjacentHTML('beforeend', `<span class="coord file">${FILES[file]}</span>`);
          }
          this.sqLayer.appendChild(d);
          this.squares[name] = d;
        }
      }
    }

    setOrientation(c) { if (c !== this.orientation) { this.orientation = c; this._build(); this.render(); this.drawArrows(); } }
    flip() { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); }

    setPosition(chess, lastMove, opts) {
      this.chess = chess;
      this.lastMove = lastMove || null;
      this.selected = null;
      this.render();
      if (opts && opts.sound && lastMove) {
        if (chess.isGameOver()) sound('end');
        else if (chess.inCheck()) sound('check');
        else sound(lastMove.captured ? 'capture' : 'move');
      }
    }

    render() {
      if (!this.chess) return;
      const style = this.pieceStyle;
      const checkSq = this.chess.inCheck() ? this.chess.kingSquare(this.chess.turn) : null;
      const dests = this.selected ? this.chess.moves({ square: this.selected, verbose: true }) : [];
      const destMap = {};
      dests.forEach((m) => { destMap[m.to] = m.captured ? 'cap' : 'dot'; });
      const arr = this.chess.boardArray();
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const name = FILES[f] + (8 - r);
          const el = this.squares[name];
          const p = arr[r][f];
          el.classList.toggle('last', !!(this.lastMove && (this.lastMove.from === name || this.lastMove.to === name)));
          el.classList.toggle('sel', this.selected === name);
          el.classList.toggle('check', checkSq === name);
          el.classList.toggle('dest', destMap[name] === 'dot');
          el.classList.toggle('capt', destMap[name] === 'cap');
          let img = el.querySelector('img.pc');
          if (p) {
            const src = Pieces.pieceSvg(p.color + p.type, style);
            if (!img) { img = document.createElement('img'); img.className = 'pc'; img.draggable = false; img.alt = p.color + p.type; el.appendChild(img); }
            if (img.getAttribute('src') !== src) img.src = src;
            img.dataset.color = p.color;
          } else if (img) img.remove();
        }
      }
    }

    /* ---------- arrows ---------- */
    setArrows(list) { this.arrows = list || []; this.drawArrows(); }
    _xy(sq) {
      const f = FILES.indexOf(sq[0]), r = parseInt(sq[1], 10) - 1;
      return this.orientation === 'w' ? [f + 0.5, 7 - r + 0.5] : [7 - f + 0.5, r + 0.5];
    }
    drawArrows() {
      let html = '<defs>';
      const colors = {};
      this.arrows.forEach((a, i) => { colors[a.color || '#e8792b'] = 1; });
      Object.keys(colors).forEach((c, i) => {
        html += `<marker id="ah${i}" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L4,2 L0,4 z" fill="${c}"/></marker>`;
        colors[c] = i;
      });
      html += '</defs>';
      for (const a of this.arrows) {
        const [x1, y1] = this._xy(a.from), [x2, y2] = this._xy(a.to);
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
        const ex = x2 - (dx / len) * 0.38, ey = y2 - (dy / len) * 0.38;
        const c = a.color || '#e8792b';
        html += `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${c}" stroke-width="${a.width || 0.17}" stroke-linecap="round" opacity="${a.opacity || 0.85}" marker-end="url(#ah${colors[c]})"/>`;
      }
      this.arrowLayer.innerHTML = html;
    }

    /* ---------- interaction ---------- */
    _sqFromPoint(x, y) {
      const rect = this.sqLayer.getBoundingClientRect();
      if (x < rect.left || y < rect.top || x > rect.right || y > rect.bottom) return null;
      const f = Math.floor(((x - rect.left) / rect.width) * 8), r = Math.floor(((y - rect.top) / rect.height) * 8);
      const file = this.orientation === 'w' ? f : 7 - f, rank = this.orientation === 'w' ? 7 - r : r;
      return FILES[file] + (rank + 1);
    }

    _canMove(sq) {
      if (!this.chess) return false;
      const p = this.chess.get(sq);
      return p && p.color === this.chess.turn && this.opts.movable(p.color) && !this.chess.isGameOver();
    }

    _bindPointer() {
      let drag = null;
      this.el.addEventListener('contextmenu', (e) => e.preventDefault());
      this.el.addEventListener('pointerdown', (e) => {
        if (e.button === 2) { this.setArrows([]); return; }
        if (!this.promoLayer.classList.contains('hidden')) return;
        const sq = this._sqFromPoint(e.clientX, e.clientY);
        if (!sq) return;
        if (this.selected && this.selected !== sq) {
          const ok = this._tryMove(this.selected, sq);
          if (ok) return;
        }
        if (this._canMove(sq)) {
          this.selected = sq;
          this.render();
          const img = this.squares[sq].querySelector('img.pc');
          if (img) {
            const ghost = img.cloneNode();
            ghost.className = 'pc ghost';
            const size = this.squares[sq].getBoundingClientRect().width;
            ghost.style.width = ghost.style.height = size + 'px';
            document.body.appendChild(ghost);
            drag = { from: sq, ghost, img, size, moved: false };
            this._moveGhost(drag, e);
            this.el.setPointerCapture(e.pointerId);
          }
        } else {
          this.selected = null;
          this.render();
        }
      });
      this.el.addEventListener('pointermove', (e) => {
        if (!drag) return;
        drag.moved = true;
        drag.img.style.opacity = '0.25';
        this._moveGhost(drag, e);
      });
      const end = (e) => {
        if (!drag) return;
        const d = drag; drag = null;
        d.ghost.remove();
        d.img.style.opacity = '';
        const sq = this._sqFromPoint(e.clientX, e.clientY);
        if (d.moved && sq && sq !== d.from) this._tryMove(d.from, sq);
      };
      this.el.addEventListener('pointerup', end);
      this.el.addEventListener('pointercancel', end);
    }

    _moveGhost(d, e) {
      d.ghost.style.left = e.clientX - d.size / 2 + 'px';
      d.ghost.style.top = e.clientY - d.size / 2 + 'px';
    }

    _tryMove(from, to) {
      const legal = this.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
      if (!legal.length) return false;
      if (legal[0].promotion) { this._askPromo(from, to); return true; }
      this.selected = null;
      this.opts.onMove(from, to);
      return true;
    }

    _askPromo(from, to) {
      const color = this.chess.turn;
      this.promoLayer.innerHTML = '<div class="promo-box"><div class="promo-title">PROMOTE</div>' + ['q', 'r', 'b', 'n'].map((t) =>
        `<button data-p="${t}" title="${{ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[t]}"><img src="${Pieces.pieceSvg(color + t, this.pieceStyle)}"></button>`).join('') + '</div>';
      this.promoLayer.classList.remove('hidden');
      this.promoLayer.onclick = (e) => {
        const b = e.target.closest('button');
        this.promoLayer.classList.add('hidden');
        this.selected = null;
        if (b) this.opts.onMove(from, to, b.dataset.p); else this.render();
      };
    }
  }

  root.Board = Board;
  root.boardSound = sound;
})(window);
