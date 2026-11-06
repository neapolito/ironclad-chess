/*  IronForge Chess — rules core
    Full legal chess: castling, en passant, promotion, check/mate/stalemate,
    50-move, threefold repetition, insufficient material, FEN, SAN, PGN.
    Works in the browser, in Web Workers (importScripts) and in Node.        */
(function (root) {
  'use strict';

  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const FILES = 'abcdefgh';

  // 0x88 helpers
  const sqName = (s) => FILES[s & 7] + (8 - (s >> 4));
  const sqIndex = (n) => (8 - parseInt(n[1], 10)) * 16 + FILES.indexOf(n[0]);
  const onBoard = (s) => (s & 0x88) === 0;
  const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');

  const KNIGHT = [-33, -31, -18, -14, 14, 18, 31, 33];
  const KING = [-17, -16, -15, -1, 1, 15, 16, 17];
  const BISHOP = [-17, -15, 15, 17];
  const ROOK = [-16, -1, 1, 16];

  const CASTLE = { K: 1, Q: 2, k: 4, q: 8 };
  // rook squares whose movement/capture removes castling rights
  const ROOK_RIGHTS = { 119: 1, 112: 2, 7: 4, 0: 8 };

  class Chess {
    constructor(fen) {
      this.load(fen || START_FEN);
    }

    /* ---------------- FEN ---------------- */
    load(fen) {
      const parts = fen.trim().split(/\s+/);
      if (parts.length < 4) throw new Error('Invalid FEN');
      this.board = new Array(128).fill(null);
      this.kings = { w: -1, b: -1 };
      const rows = parts[0].split('/');
      if (rows.length !== 8) throw new Error('Invalid FEN board');
      for (let r = 0; r < 8; r++) {
        let f = 0;
        for (const ch of rows[r]) {
          if (/[1-8]/.test(ch)) f += parseInt(ch, 10);
          else if (/[pnbrqkPNBRQK]/.test(ch)) {
            if (f > 7) throw new Error('Invalid FEN row');
            const s = r * 16 + f;
            this.board[s] = ch;
            if (ch === 'K') this.kings.w = s;
            if (ch === 'k') this.kings.b = s;
            f++;
          } else throw new Error('Invalid FEN char ' + ch);
        }
        if (f !== 8) throw new Error('Invalid FEN row length');
      }
      if (this.kings.w < 0 || this.kings.b < 0) throw new Error('FEN needs both kings');
      this.turn = parts[1] === 'b' ? 'b' : 'w';
      this.castling = 0;
      if (parts[2] !== '-') for (const c of parts[2]) this.castling |= CASTLE[c] || 0;
      this.ep = parts[3] !== '-' ? sqIndex(parts[3]) : -1;
      this.half = parseInt(parts[4] || '0', 10);
      this.full = parseInt(parts[5] || '1', 10);
      this.stack = [];
      this.sanHistory = [];
      this.startFen = this.fen();
      this.reps = new Map();
      this._countRep(1);
      return this;
    }

    fen() {
      let out = '';
      for (let r = 0; r < 8; r++) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.board[r * 16 + f];
          if (!p) empty++;
          else { if (empty) { out += empty; empty = 0; } out += p; }
        }
        if (empty) out += empty;
        if (r < 7) out += '/';
      }
      let c = '';
      if (this.castling & 1) c += 'K';
      if (this.castling & 2) c += 'Q';
      if (this.castling & 4) c += 'k';
      if (this.castling & 8) c += 'q';
      return `${out} ${this.turn} ${c || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.half} ${this.full}`;
    }

    posKey() { return this.fen().split(' ').slice(0, 4).join(' '); }
    _countRep(d) {
      const k = this.posKey();
      const n = (this.reps.get(k) || 0) + d;
      if (n <= 0) this.reps.delete(k); else this.reps.set(k, n);
    }

    get(sq) { const p = this.board[sqIndex(sq)]; return p ? { type: p.toLowerCase(), color: colorOf(p) } : null; }

    /* ---------------- attacks ---------------- */
    attacked(sq, by) {
      const b = this.board;
      // pawns
      if (by === 'w') {
        for (const d of [15, 17]) { const s = sq + d; if (onBoard(s) && b[s] === 'P') return true; }
      } else {
        for (const d of [-15, -17]) { const s = sq + d; if (onBoard(s) && b[s] === 'p') return true; }
      }
      const N = by === 'w' ? 'N' : 'n', K = by === 'w' ? 'K' : 'k';
      const B = by === 'w' ? 'B' : 'b', R = by === 'w' ? 'R' : 'r', Q = by === 'w' ? 'Q' : 'q';
      for (const d of KNIGHT) { const s = sq + d; if (onBoard(s) && b[s] === N) return true; }
      for (const d of KING) { const s = sq + d; if (onBoard(s) && b[s] === K) return true; }
      for (const d of BISHOP) {
        let s = sq + d;
        while (onBoard(s)) { const p = b[s]; if (p) { if (p === B || p === Q) return true; break; } s += d; }
      }
      for (const d of ROOK) {
        let s = sq + d;
        while (onBoard(s)) { const p = b[s]; if (p) { if (p === R || p === Q) return true; break; } s += d; }
      }
      return false;
    }

    inCheck(color) { color = color || this.turn; return this.attacked(this.kings[color], color === 'w' ? 'b' : 'w'); }

    /* ---------------- move generation ---------------- */
    _pseudo(capturesOnly) {
      const moves = [], b = this.board, us = this.turn, them = us === 'w' ? 'b' : 'w';
      const add = (from, to, piece, flags, promo) => {
        const captured = flags === 'e' ? (us === 'w' ? 'p' : 'P') : b[to];
        if (promo) for (const pr of ['q', 'r', 'b', 'n']) moves.push({ from, to, piece, captured, flags: flags + 'p', promo: pr });
        else moves.push({ from, to, piece, captured, flags });
      };
      for (let s = 0; s < 120; s++) {
        if (s & 0x88) { s += 7; continue; }
        const p = b[s];
        if (!p || colorOf(p) !== us) continue;
        const t = p.toLowerCase();
        if (t === 'p') {
          const dir = us === 'w' ? -16 : 16, startRank = us === 'w' ? 6 : 1, promoRank = us === 'w' ? 1 : 6;
          const rank = s >> 4, one = s + dir;
          if (!capturesOnly && onBoard(one) && !b[one]) {
            add(s, one, p, 'n', rank === promoRank);
            const two = one + dir;
            if (rank === startRank && !b[two]) add(s, two, p, 'b');
          } else if (capturesOnly && rank === promoRank && onBoard(one) && !b[one]) {
            add(s, one, p, 'n', true);
          }
          for (const d of [dir - 1, dir + 1]) {
            const c = s + d;
            if (!onBoard(c)) continue;
            if (b[c] && colorOf(b[c]) === them) add(s, c, p, 'c', rank === promoRank);
            else if (c === this.ep) add(s, c, p, 'e');
          }
        } else if (t === 'n' || t === 'k') {
          for (const d of (t === 'n' ? KNIGHT : KING)) {
            const c = s + d;
            if (!onBoard(c)) continue;
            if (!b[c]) { if (!capturesOnly) add(s, c, p, 'n'); }
            else if (colorOf(b[c]) === them) add(s, c, p, 'c');
          }
          if (t === 'k' && !capturesOnly) this._castles(s, add);
        } else {
          const dirs = t === 'b' ? BISHOP : t === 'r' ? ROOK : BISHOP.concat(ROOK);
          for (const d of dirs) {
            let c = s + d;
            while (onBoard(c)) {
              if (!b[c]) { if (!capturesOnly) add(s, c, p, 'n'); }
              else { if (colorOf(b[c]) === them) add(s, c, p, 'c'); break; }
              c += d;
            }
          }
        }
      }
      return moves;
    }

    _castles(s, add) {
      const b = this.board, us = this.turn, them = us === 'w' ? 'b' : 'w';
      const home = us === 'w' ? 116 : 4;
      if (s !== home || this.attacked(s, them)) return;
      const kFlag = us === 'w' ? 1 : 4, qFlag = us === 'w' ? 2 : 8;
      const R = us === 'w' ? 'R' : 'r';
      if ((this.castling & kFlag) && !b[s + 1] && !b[s + 2] && b[s + 3] === R &&
          !this.attacked(s + 1, them) && !this.attacked(s + 2, them)) add(s, s + 2, b[s], 'k');
      if ((this.castling & qFlag) && !b[s - 1] && !b[s - 2] && !b[s - 3] && b[s - 4] === R &&
          !this.attacked(s - 1, them) && !this.attacked(s - 2, them)) add(s, s - 2, b[s], 'q');
    }

    _make(m) {
      const b = this.board, us = this.turn, them = us === 'w' ? 'b' : 'w';
      this.stack.push({ m, castling: this.castling, ep: this.ep, half: this.half, full: this.full });
      b[m.to] = m.promo ? (us === 'w' ? m.promo.toUpperCase() : m.promo) : m.piece;
      b[m.from] = null;
      if (m.flags === 'e') b[m.to + (us === 'w' ? 16 : -16)] = null;
      if (m.flags === 'k') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
      if (m.flags === 'q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }
      const t = m.piece.toLowerCase();
      if (t === 'k') { this.kings[us] = m.to; this.castling &= us === 'w' ? ~3 : ~12; }
      if (ROOK_RIGHTS[m.from]) this.castling &= ~ROOK_RIGHTS[m.from];
      if (ROOK_RIGHTS[m.to]) this.castling &= ~ROOK_RIGHTS[m.to];
      this.ep = m.flags === 'b' ? m.from + (us === 'w' ? -16 : 16) : -1;
      this.half = (t === 'p' || m.captured) ? 0 : this.half + 1;
      if (us === 'b') this.full++;
      this.turn = them;
    }

    _unmake() {
      const st = this.stack.pop();
      if (!st) return null;
      const m = st.m, b = this.board;
      this.turn = this.turn === 'w' ? 'b' : 'w';
      const us = this.turn;
      b[m.from] = m.piece;
      b[m.to] = m.flags === 'e' ? null : (m.captured || null);
      if (m.flags === 'e') b[m.to + (us === 'w' ? 16 : -16)] = m.captured;
      if (m.flags === 'k') { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = null; }
      if (m.flags === 'q') { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = null; }
      if (m.piece.toLowerCase() === 'k') this.kings[us] = m.from;
      this.castling = st.castling; this.ep = st.ep; this.half = st.half; this.full = st.full;
      return m;
    }

    /** Legal moves in internal form (fast path for the engine). */
    legal(capturesOnly) {
      const us = this.turn, out = [];
      for (const m of this._pseudo(capturesOnly)) {
        this._make(m);
        if (!this.attacked(this.kings[us], this.turn)) out.push(m);
        this._unmake();
      }
      return out;
    }

    /* ---------------- public move API ---------------- */
    _decorate(m, legalList) {
      return {
        from: sqName(m.from), to: sqName(m.to), piece: m.piece.toLowerCase(), color: colorOf(m.piece),
        captured: m.captured ? m.captured.toLowerCase() : undefined, promotion: m.promo,
        flags: m.flags, san: this._san(m, legalList), uci: sqName(m.from) + sqName(m.to) + (m.promo || ''),
      };
    }

    moves(opts) {
      opts = opts || {};
      let list = this.legal();
      const all = list;
      if (opts.square) { const s = sqIndex(opts.square); list = list.filter((m) => m.from === s); }
      return opts.verbose ? list.map((m) => this._decorate(m, all)) : list.map((m) => this._san(m, all));
    }

    _san(m, legalList) {
      let s;
      const t = m.piece.toLowerCase();
      if (m.flags === 'k') s = 'O-O';
      else if (m.flags === 'q') s = 'O-O-O';
      else {
        s = '';
        if (t !== 'p') {
          s += t.toUpperCase();
          const others = (legalList || this.legal()).filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from);
          if (others.length) {
            const sameFile = others.some((o) => (o.from & 7) === (m.from & 7));
            const sameRank = others.some((o) => (o.from >> 4) === (m.from >> 4));
            if (!sameFile) s += FILES[m.from & 7];
            else if (!sameRank) s += 8 - (m.from >> 4);
            else s += sqName(m.from);
          }
        }
        if (m.captured) { if (t === 'p') s += FILES[m.from & 7]; s += 'x'; }
        s += sqName(m.to);
        if (m.promo) s += '=' + m.promo.toUpperCase();
      }
      this._make(m);
      if (this.inCheck()) s += this.legal().length ? '+' : '#';
      this._unmake();
      return s;
    }

    /** move('e4') | move('e2e4') | move({from:'e2', to:'e4', promotion:'q'}) */
    move(mv) {
      const list = this.legal();
      let found = null;
      if (typeof mv === 'string') {
        const clean = mv.replace(/[+#?!]+$/g, '').replace(/^0-0-0$/, 'O-O-O').replace(/^0-0$/, 'O-O');
        if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(clean)) {
          mv = { from: clean.slice(0, 2), to: clean.slice(2, 4), promotion: clean[4] };
        } else {
          for (const m of list) {
            const san = this._san(m, list).replace(/[+#]$/, '');
            if (san === clean || san.replace('x', '') === clean.replace('x', '') ||
                (m.promo && san.replace('=', '') === clean.replace('=', ''))) { found = m; break; }
          }
          if (!found) return null;
        }
      }
      if (!found) {
        const f = sqIndex(mv.from), t = sqIndex(mv.to);
        const promo = (mv.promotion || 'q').toLowerCase();
        found = list.find((m) => m.from === f && m.to === t && (!m.promo || m.promo === promo));
        if (!found) return null;
      }
      const out = this._decorate(found, list);
      this._make(found);
      this.sanHistory.push(out);
      this._countRep(1);
      return out;
    }

    undo() {
      if (!this.stack.length) return null;
      this._countRep(-1);
      this._unmake();
      return this.sanHistory.pop();
    }

    history(opts) { return opts && opts.verbose ? this.sanHistory.slice() : this.sanHistory.map((m) => m.san); }

    /* ---------------- game state ---------------- */
    insufficient() {
      const pcs = [];
      for (let s = 0; s < 120; s++) { if (s & 0x88) { s += 7; continue; } const p = this.board[s]; if (p && p.toLowerCase() !== 'k') pcs.push([p.toLowerCase(), ((s >> 4) + (s & 7)) % 2]); }
      if (!pcs.length) return true;
      if (pcs.length === 1 && (pcs[0][0] === 'n' || pcs[0][0] === 'b')) return true;
      if (pcs.every((x) => x[0] === 'b')) return pcs.every((x) => x[1] === pcs[0][1]);
      return false;
    }
    isCheckmate() { return this.inCheck() && this.legal().length === 0; }
    isStalemate() { return !this.inCheck() && this.legal().length === 0; }
    isThreefold() { return (this.reps.get(this.posKey()) || 0) >= 3; }
    isDraw() { return this.half >= 100 || this.isStalemate() || this.insufficient() || this.isThreefold(); }
    isGameOver() { return this.legal().length === 0 || this.isDraw(); }
    result() {
      if (this.isCheckmate()) return { result: this.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
      if (this.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
      if (this.insufficient()) return { result: '1/2-1/2', reason: 'insufficient material' };
      if (this.isThreefold()) return { result: '1/2-1/2', reason: 'threefold repetition' };
      if (this.half >= 100) return { result: '1/2-1/2', reason: '50-move rule' };
      return null;
    }

    /* ---------------- PGN ---------------- */
    pgn(headers) {
      headers = Object.assign({ Event: 'IronForge Chess game', Site: 'IronForge Chess', Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'), White: '?', Black: '?', Result: '*' }, headers || {});
      if (this.startFen !== START_FEN) { headers.SetUp = '1'; headers.FEN = this.startFen; }
      let out = Object.entries(headers).map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`).join('\n') + '\n\n';
      const startTurn = this.startFen.split(' ')[1];
      let num = parseInt(this.startFen.split(' ')[5] || '1', 10);
      let line = '';
      this.sanHistory.forEach((m, i) => {
        const white = (i % 2 === 0) === (startTurn === 'w');
        if (white) line += `${num}. `;
        else if (i === 0) line += `${num}... `;
        line += m.san + ' ';
        if (!white) num++;
      });
      return out + (line + headers.Result).trim() + '\n';
    }

    static parsePgn(text) {
      const headers = {};
      text.replace(/\[(\w+)\s+"([^"]*)"\]/g, (_, k, v) => { headers[k] = v; return ''; });
      let body = text.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
      // strip nested variations
      let prev;
      do { prev = body; body = body.replace(/\([^()]*\)/g, ' '); } while (body !== prev);
      body = body.replace(/\$\d+/g, ' ').replace(/\d+\.(\.\.)?/g, ' ').replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/, ' ');
      const tokens = body.split(/\s+/).filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
      const game = new Chess(headers.FEN || START_FEN);
      for (const tok of tokens) {
        if (!game.move(tok)) throw new Error('Illegal move in PGN: ' + tok);
      }
      return { game, headers };
    }

    /** Board as 8x8 array from rank 8 down, each {type,color}|null */
    boardArray() {
      const rows = [];
      for (let r = 0; r < 8; r++) {
        const row = [];
        for (let f = 0; f < 8; f++) { const p = this.board[r * 16 + f]; row.push(p ? { type: p.toLowerCase(), color: colorOf(p), square: sqName(r * 16 + f) } : null); }
        rows.push(row);
      }
      return rows;
    }

    kingSquare(c) { return sqName(this.kings[c]); }
    perft(depth) {
      if (depth === 0) return 1;
      let n = 0;
      for (const m of this.legal()) { this._make(m); n += this.perft(depth - 1); this._unmake(); }
      return n;
    }
  }

  Chess.START_FEN = START_FEN;
  Chess.sqName = sqName;
  Chess.sqIndex = sqIndex;
  root.Chess = Chess;
  if (typeof module !== 'undefined' && module.exports) module.exports = Chess;
})(typeof self !== 'undefined' ? self : globalThis);
