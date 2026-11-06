/*  Game review: engine pass over every position, win%-based move
    classification (Brilliant → Blunder), accuracy per side, eval graph. */
(function () {
  const { esc, $, $$ } = App;

  const CLASSES = {
    brilliant: { label: 'Brilliant', sym: '!!', color: '#22c2c9' },
    best: { label: 'Best', sym: '★', color: '#62b246' },
    excellent: { label: 'Excellent', sym: '!', color: '#86c35a' },
    good: { label: 'Good', sym: '✓', color: '#9bb07a' },
    book: { label: 'Book', sym: '📖', color: '#a88b5e' },
    inaccuracy: { label: 'Inaccuracy', sym: '?!', color: '#e6c13d' },
    mistake: { label: 'Mistake', sym: '?', color: '#e8792b' },
    blunder: { label: 'Blunder', sym: '??', color: '#d6322b' },
  };
  App.REVIEW_CLASSES = CLASSES;
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  function isSacrifice(after, mv) {
    // the moved piece can be taken for less than it is worth
    if (VAL[mv.piece] < 3) return false;
    const gained = mv.captured ? VAL[mv.captured] : 0;
    const opp = after.turn;
    const caps = after.moves({ verbose: true }).filter((m) => m.to === mv.to && m.captured);
    if (!caps.length) return false;
    const cheapest = Math.min(...caps.map((m) => VAL[m.piece]));
    const defended = after.attacked(Chess.sqIndex(mv.to), opp === 'w' ? 'b' : 'w');
    return VAL[mv.piece] - gained >= 2 && (!defended || cheapest < VAL[mv.piece]);
  }

  /** Runs the engine over a game. Returns per-ply data and accuracies. */
  App.reviewGame = async function (startFen, uciMoves, engine, depthMode, onProgress) {
    const settings = {
      quick: { stockfish: { depth: 10 }, ironclad: { movetime: 350 } },
      standard: { stockfish: { depth: 13 }, ironclad: { movetime: 900 } },
      deep: { stockfish: { depth: 16 }, ironclad: { movetime: 2200 } },
    }[depthMode || 'standard'];
    const c = new Chess(startFen);
    const fens = [c.fen()], moves = [];
    for (const u of uciMoves) { const m = c.move(u); if (!m) break; moves.push(m); fens.push(c.fen()); }
    const evals = [], bests = [];
    let usedEngine = engine;
    for (let i = 0; i < fens.length; i++) {
      const g = new Chess(fens[i]);
      const r = g.result();
      if (r) { evals.push(r.result === '1-0' ? { cp: 10000 } : r.result === '0-1' ? { cp: -10000 } : { cp: 0 }); bests.push(null); }
      else {
        const p = Object.assign({ fen: fens[i], multipv: 1 }, settings[usedEngine === 'stockfish' ? 'stockfish' : 'ironclad']);
        const res = await Engines.analyze(usedEngine, p);
        usedEngine = res.engine;
        evals.push(res.score || { cp: 0 }); bests.push(res.move);
      }
      if (onProgress) onProgress((i + 1) / fens.length, usedEngine);
    }
    const plies = moves.map((m, i) => {
      const mover = m.color;
      const wpB = App.winPct(App.scoreCp(evals[i])), wpA = App.winPct(App.scoreCp(evals[i + 1]));
      const before = mover === 'w' ? wpB : 100 - wpB, after = mover === 'w' ? wpA : 100 - wpA;
      const loss = Math.max(0, before - after);
      const acc = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
      let cls;
      const isBest = bests[i] && bests[i] === m.uci;
      if (i < 8 && loss < 3 && Math.abs(App.scoreCp(evals[i + 1])) < 80 && ['e4', 'd4', 'c4', 'Nf3', 'e5', 'd5', 'c5', 'e6', 'c6', 'Nf6', 'g6', 'd6', 'Nc3', 'Nc6', 'Bb5', 'Bc4', 'g3', 'b3', 'f4', 'Bg2', 'Be7', 'Bb4'].includes(m.san.replace(/[+#]/, '')) && startFen === Chess.START_FEN) cls = 'book';
      else if (isBest || loss < 1) {
        cls = isSacrifice(new Chess(fens[i + 1]), m) && before < 97 && after > 45 ? 'brilliant' : 'best';
      } else if (loss < 2.5) cls = 'excellent';
      else if (loss < 6) cls = 'good';
      else if (loss < 12) cls = 'inaccuracy';
      else if (loss < 22) cls = 'mistake';
      else cls = 'blunder';
      return { m, fenBefore: fens[i], fenAfter: fens[i + 1], evalBefore: evals[i], evalAfter: evals[i + 1], best: bests[i], loss, acc, cls };
    });
    const accOf = (col) => { const l = plies.filter((p) => p.m.color === col); return l.length ? l.reduce((a, p) => a + p.acc, 0) / l.length : 0; };
    return { startFen, fens, evals, plies, engine: usedEngine, accuracy: { w: accOf('w'), b: accOf('b') } };
  };

  function bestSan(fen, uci) { if (!uci) return ''; const c = new Chess(fen); const m = c.move(uci); return m ? m.san : uci; }

  App.route('/review', async ([src, id]) => {
    let pgn = '', title = '';
    if (src === 'local' && id) { const g = App.history.get(id); if (g) { pgn = g.pgn; title = `${g.white} vs ${g.black}`; } }
    if (src === 'online' && id) {
      const g = await new Promise((res) => { const un = App.backend.watchGame(id, (x) => { res(x); setTimeout(() => un && un(), 0); }); });
      if (g) { const c = new Chess(); g.moves.forEach((u) => c.move(u)); pgn = c.pgn({ White: g.whiteName, Black: g.blackName, Result: g.result || '*' }); title = `${g.whiteName} vs ${g.blackName}`; }
    }
    if (!pgn) return picker();
    runReview(pgn, title);
  });

  function picker() {
    const hist = App.history.list();
    App.view.innerHTML = `<div class="game-layout"><div class="panel riveted grow"><div class="panel-head"><h2>Game Review</h2></div><div class="pad form">
      <label>Paste a PGN (from here, Lichess, Chess.com…)<textarea id="rpgn" rows="8" class="mono" placeholder="1. e4 e5 2. Nf3 Nc6 3. Bb5 ..."></textarea></label>
      <div class="row"><button class="btn big" id="go">✎ Review this game</button></div></div></div>
      <div class="panel riveted side-col"><div class="panel-head"><h3>Or pick a saved game</h3></div><div class="pad">
      ${hist.length ? `<table class="tbl">${hist.slice(0, 40).map((g) => `<tr><td>${esc(g.white)} vs ${esc(g.black)}<div class="muted small">${esc(g.type)} · ${new Date(g.date).toLocaleString()}</div></td><td><b>${esc(g.result)}</b></td><td><a class="btn small" href="#/review/local/${g.id}">Review</a></td><td><button class="btn small ghost" data-del="${g.id}" title="Delete">✕</button></td></tr>`).join('')}</table>` : '<p class="muted">Play a game first — it will show up here.</p>'}
      </div></div></div>`;
    $('#go').onclick = () => {
      try { Chess.parsePgn($('#rpgn').value); } catch (e) { return App.toast(e.message, 'bad'); }
      const id = App.history.add({ type: 'import', date: Date.now(), white: (($('#rpgn').value.match(/\[White "([^"]*)"/) || [])[1]) || 'White', black: (($('#rpgn').value.match(/\[Black "([^"]*)"/) || [])[1]) || 'Black', result: (($('#rpgn').value.match(/\[Result "([^"]*)"/) || [])[1]) || '*', pgn: $('#rpgn').value });
      App.go('/review/local/' + id);
    };
    $$('[data-del]').forEach((b) => b.onclick = () => { App.history.remove(b.dataset.del); picker(); });
  }

  function runReview(pgn, title) {
    let parsed;
    try { parsed = Chess.parsePgn(pgn); } catch (e) { App.toast(e.message, 'bad'); return picker(); }
    const uci = parsed.game.history({ verbose: true }).map((m) => m.uci);
    const startFen = parsed.game.startFen;
    App.view.innerHTML = `<div class="game-layout review">
      <div class="board-col"><div class="board-and-bar">${App.evalBarHtml()}<div class="board-frame"><div id="board"></div></div></div>
        <div class="navbar"><button class="btn small" data-nav="first">⏮</button><button class="btn small" data-nav="prev">◀</button><button class="btn small" data-nav="next">▶</button><button class="btn small" data-nav="last">⏭</button><button class="btn small ghost" id="flip">⇅</button><button class="btn small ghost" id="toanalysis">🔍 Analyze here</button></div>
        <div class="panel riveted"><div class="pad"><canvas id="graph" height="120"></canvas></div></div></div>
      <div class="side-col">
        <div class="panel riveted"><div class="panel-head"><h3>${esc(title || 'Game Review')}</h3></div><div class="pad" id="rv-top">
          <div class="row"><select id="rv-eng" class="grow"><option value="stockfish">Stockfish 10</option><option value="ironclad">Ironclad (built-in)</option></select>
          <select id="rv-depth"><option value="quick">Quick</option><option value="standard" selected>Standard</option><option value="deep">Deep</option></select>
          <button class="btn" id="rv-run">▶ Run review</button></div>
          <div class="progress hidden" id="rv-prog"><div></div><span></span></div>
          <div id="rv-summary"></div></div></div>
        <div class="panel riveted"><div class="panel-head"><h3>Moves</h3></div><div class="pad"><div id="rv-comment" class="comment"></div><div id="moves"></div></div></div>
      </div></div>`;
    let ply = 0, data = null;
    const board = new Board($('#board'), { movable: () => false });
    const sans = parsed.game.history();
    function show() {
      const c = new Chess(startFen); let last = null;
      for (let i = 0; i < ply; i++) last = c.move(uci[i]);
      board.setPosition(c, last);
      const classes = data ? data.plies.map((p) => p.cls) : null;
      $('#moves').innerHTML = App.moveListHtml(sans, ply, classes, startFen.split(' ')[1], parseInt(startFen.split(' ')[5], 10));
      $$('#moves .mv[data-ply]').forEach((el) => el.onclick = () => { ply = +el.dataset.ply; show(); });
      const cur = $('#moves .mv.cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
      const arrows = [];
      let comment = '';
      if (data) {
        App.setEvalBar(data.evals[ply], board.orientation);
        if (ply > 0) {
          const p = data.plies[ply - 1], k = CLASSES[p.cls];
          arrows.push({ from: p.m.from, to: p.m.to, color: k.color, opacity: 0.75 });
          const bs = bestSan(p.fenBefore, p.best);
          comment = `<div class="cm-head" style="--cc:${k.color}"><i class="ci ci-${p.cls}"></i><b>${esc(p.m.san)}</b> is ${/^[aeiou]/i.test(k.label) ? 'an' : 'a'} <b>${k.label.toLowerCase()}</b> move <span class="ev">${App.fmtEval(p.evalAfter)}</span></div>`;
          if (['inaccuracy', 'mistake', 'blunder', 'good', 'excellent'].includes(p.cls) && p.best && p.best !== p.m.uci) {
            comment += `<div class="cm-best">Best was <b>${esc(bs)}</b> (${App.fmtEval(p.evalBefore)})</div>`;
            arrows.push({ from: p.best.slice(0, 2), to: p.best.slice(2, 4), color: '#4fd16a', opacity: 0.9 });
          }
        } else comment = '<div class="muted">Starting position. Use ◀ ▶ or the arrow keys.</div>';
        drawGraph();
      } else comment = '<div class="muted">Press “Run review” to analyze every move.</div>';
      $('#rv-comment').innerHTML = comment;
      board.setArrows(arrows);
    }
    function drawGraph() {
      const cv = $('#graph'); if (!cv || !data) return;
      const w = cv.width = cv.clientWidth * devicePixelRatio, h = cv.height = 120 * devicePixelRatio;
      const x = cv.getContext('2d'); x.clearRect(0, 0, w, h);
      const n = data.evals.length - 1 || 1;
      const ys = data.evals.map((e) => h - (App.winPct(App.scoreCp(e)) / 100) * h);
      x.fillStyle = '#16120d'; x.fillRect(0, 0, w, h);
      x.beginPath(); x.moveTo(0, h);
      ys.forEach((y, i) => x.lineTo((i / n) * w, y)); x.lineTo(w, h); x.closePath();
      x.fillStyle = '#e9dfc9'; x.fill();
      x.strokeStyle = '#8a6a3a'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
      data.plies.forEach((p, i) => {
        if (['blunder', 'mistake', 'inaccuracy', 'brilliant'].includes(p.cls)) { x.fillStyle = CLASSES[p.cls].color; x.beginPath(); x.arc(((i + 1) / n) * w, ys[i + 1], 4 * devicePixelRatio, 0, 7); x.fill(); }
      });
      x.fillStyle = '#e8792b'; x.fillRect((ply / n) * w - devicePixelRatio, 0, 2 * devicePixelRatio, h);
    }
    $('#graph').onclick = (e) => { if (!data) return; const r = e.target.getBoundingClientRect(); ply = Math.round(((e.clientX - r.left) / r.width) * (data.evals.length - 1)); show(); };
    function summary() {
      const cnt = (col) => { const o = {}; Object.keys(CLASSES).forEach((k) => o[k] = 0); data.plies.filter((p) => p.m.color === col).forEach((p) => o[p.cls]++); return o; };
      const W = cnt('w'), B = cnt('b');
      const wn = parsed.headers.White || 'White', bn = parsed.headers.Black || 'Black';
      $('#rv-summary').innerHTML = `<div class="acc-row"><div class="acc w"><span>${esc(wn)}</span><b>${data.accuracy.w.toFixed(1)}</b><i>accuracy</i></div><div class="acc b"><span>${esc(bn)}</span><b>${data.accuracy.b.toFixed(1)}</b><i>accuracy</i></div></div>
        <table class="tbl cls-table">${Object.entries(CLASSES).map(([k, v]) => `<tr><td class="c">${W[k]}</td><td><i class="ci ci-${k}"></i> ${v.label}</td><td class="c">${B[k]}</td></tr>`).join('')}</table>
        <p class="muted small">Engine: ${esc(Engines.ENGINES[data.engine].name)}</p>`;
    }
    const nav = { first: () => 0, prev: () => Math.max(0, ply - 1), next: () => Math.min(uci.length, ply + 1), last: () => uci.length };
    $$('[data-nav]').forEach((b) => b.onclick = () => { ply = nav[b.dataset.nav](); show(); });
    const keys = (e) => { const k = { ArrowLeft: 'prev', ArrowRight: 'next', ArrowUp: 'first', ArrowDown: 'last' }[e.key]; if (k && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); ply = nav[k](); show(); } };
    document.addEventListener('keydown', keys); App.cleanup.push(() => document.removeEventListener('keydown', keys));
    $('#flip').onclick = () => { board.flip(); show(); };
    $('#toanalysis').onclick = () => App.analysisBoard(startFen, uci, ply);
    let running = false;
    $('#rv-run').onclick = async () => {
      if (running) return; running = true;
      $('#rv-run').disabled = true; $('#rv-prog').classList.remove('hidden');
      try {
        data = await App.reviewGame(startFen, uci, $('#rv-eng').value, $('#rv-depth').value, (f, eng) => {
          $('#rv-prog div').style.width = (f * 100) + '%';
          $('#rv-prog span').textContent = `Analyzing with ${Engines.ENGINES[eng].name}… ${Math.round(f * 100)}%`;
        });
        summary(); show();
      } catch (e) { if (e.message !== 'stopped') App.toast('Review failed: ' + e.message, 'bad'); }
      running = false; $('#rv-run').disabled = false; $('#rv-prog').classList.add('hidden');
    };
    show();
    $('#rv-run').click();
  }
})();
