/*  Analysis board: free play for both sides, live engine lines, eval bar,
    FEN/PGN import & export, navigation through the move list.          */
(function () {
  const { esc, $, $$ } = App;

  App.evalBarHtml = () => `<div class="evalbar" id="evalbar"><div class="eb-fill" id="eb-fill"></div><span class="eb-txt" id="eb-txt">0.0</span></div>`;
  App.setEvalBar = function (score, orientation) {
    const fill = $('#eb-fill'), txt = $('#eb-txt'), bar = $('#evalbar');
    if (!fill) return;
    const cp = App.scoreCp(score);
    const pct = App.winPct(cp);
    fill.style.height = pct + '%';
    bar.classList.toggle('flipped', orientation === 'b');
    const s = score && score.mate !== undefined ? 'M' + Math.abs(score.mate) : Math.abs(cp / 100).toFixed(1);
    txt.textContent = s;
    txt.className = 'eb-txt ' + (cp >= 0 ? 'w' : 'b');
  };

  App.route('/analysis', async ([src, id]) => {
    let startFen = Chess.START_FEN, startMoves = [];
    if (src === 'local' && id) {
      const g = App.history.get(id);
      if (g) { const r = Chess.parsePgn(g.pgn); startFen = r.game.startFen; startMoves = r.game.history({ verbose: true }).map((m) => m.uci); }
    } else if (src === 'fen' && id) startFen = id;
    analysisBoard(startFen, startMoves);
  });

  App.analysisBoard = analysisBoard;
  function analysisBoard(startFen, uciMoves, cursor) {
    App.view.innerHTML = `<div class="game-layout analysis">
      <div class="board-col"><div class="board-and-bar">${App.evalBarHtml()}<div class="board-frame"><div id="board"></div></div></div>
        <div class="navbar"><button class="btn small" data-nav="first">⏮</button><button class="btn small" data-nav="prev">◀</button><button class="btn small" data-nav="next">▶</button><button class="btn small" data-nav="last">⏭</button><button class="btn small ghost" id="flip">⇅ Flip</button></div></div>
      <div class="side-col">
        <div class="panel riveted"><div class="panel-head"><h3>Engine</h3>
          <label class="switch"><input type="checkbox" id="eng-on" checked><span></span>ON</label></div>
          <div class="pad">
            <div class="row"><select id="eng-sel" class="grow">${Object.values(Engines.ENGINES).map((e) => `<option value="${e.id}">${esc(e.name)} — ${e.tag}</option>`).join('')}</select>
            <select id="eng-lines"><option value="1">1 line</option><option value="2">2 lines</option><option value="3" selected>3 lines</option></select></div>
            <p class="muted small" id="eng-desc"></p>
            <div class="eng-head"><span id="eng-depth">depth —</span><span id="eng-name"></span></div>
            <div id="lines" class="lines"></div>
          </div></div>
        <div class="panel riveted"><div class="panel-head"><h3>Moves</h3><span class="muted small" id="opening"></span></div><div class="pad"><div id="moves"></div>
          <div class="btnbar"><button class="btn small" id="undo">↶ Undo</button><button class="btn small ghost" id="reset">⟲ Start position</button><button class="btn small" id="toreview">✎ Review</button><button class="btn small ghost" id="save">💾 Save</button></div></div></div>
        <div class="panel riveted"><div class="panel-head"><h3>Import / Export</h3></div><div class="pad form">
          <label>FEN<div class="row"><input id="fen" class="grow mono"><button class="btn small" id="loadfen">Load</button></div></label>
          <label>PGN<textarea id="pgn" rows="4" class="mono" placeholder="Paste a PGN and press Load PGN"></textarea></label>
          <div class="row"><button class="btn small" id="loadpgn">Load PGN</button><button class="btn small ghost" id="copypgn">Copy PGN</button><button class="btn small ghost" id="copyfen">Copy FEN</button></div>
        </div></div>
      </div></div>`;

    // line of moves (uci) from startFen; ply = how many are applied
    let line = uciMoves.slice(), ply = cursor === undefined ? line.length : cursor;
    let pos = new Chess(startFen), lastMove = null;
    const board = new Board($('#board'), {
      movable: () => true,
      onMove: (from, to, promo) => {
        const m = pos.move({ from, to, promotion: promo });
        if (!m) return;
        if (line[ply] === m.uci) { ply++; }
        else { line = line.slice(0, ply); line.push(m.uci); ply++; }
        lastMove = m; refresh(true);
      },
    });
    function rebuild() {
      pos = new Chess(startFen); lastMove = null;
      for (let i = 0; i < ply; i++) lastMove = pos.move(line[i]);
    }
    function sans() { const c = new Chess(startFen); return line.map((u) => c.move(u).san); }
    let engToken = 0;
    function refresh(sound) {
      board.setPosition(pos, lastMove, { sound });
      board.setArrows([]);
      $('#moves').innerHTML = App.moveListHtml(sans(), ply, null, startFen.split(' ')[1], parseInt(startFen.split(' ')[5], 10));
      $$('#moves .mv[data-ply]').forEach((el) => el.onclick = () => { ply = +el.dataset.ply; rebuild(); refresh(false); });
      const cur = $('#moves .mv.cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
      $('#fen').value = pos.fen();
      runEngine();
    }
    function runEngine() {
      const my = ++engToken;
      const id = $('#eng-sel').value;
      $('#eng-desc').textContent = Engines.ENGINES[id].desc;
      $('#eng-name').textContent = '';
      if (!$('#eng-on').checked) { $('#lines').innerHTML = '<p class="muted">Engine off.</p>'; Engines.stopAll(); return; }
      const r = pos.result();
      if (r) { $('#lines').innerHTML = `<p class="result-line">${esc(r.result)} — ${esc(r.reason)}</p>`; App.setEvalBar(r.result === '1-0' ? { mate: 1 } : r.result === '0-1' ? { mate: -1 } : { cp: 0 }); return; }
      $('#lines').innerHTML = '<p class="muted">Thinking…</p>';
      const fen = pos.fen(), n = +$('#eng-lines').value;
      Engines.stopAll();
      Engines.analyze(id, { fen, multipv: n, movetime: id === 'stockfish' ? 6000 : 4000, history: [...pos.reps.keys()].filter((k) => k !== pos.posKey()) }, (info) => {
        if (my !== engToken) return;
        $('#eng-depth').textContent = 'depth ' + info.depth;
        $('#lines').innerHTML = info.lines.map((l, i) => `<div class="eline" data-i="${i}"><span class="ev ${App.scoreCp(l.score) >= 0 ? 'w' : 'b'}">${App.fmtEval(l.score)}</span><span class="pv">${esc(App.uciToSan(fen, l.pv, 10))}</span></div>`).join('');
        $$('#lines .eline').forEach((el) => el.onclick = () => { const u = info.lines[+el.dataset.i].pv[0]; board.opts.onMove(u.slice(0, 2), u.slice(2, 4), u[4]); });
        App.setEvalBar(info.lines[0].score, board.orientation);
        board.setArrows(info.lines.slice(0, 3).map((l, i) => ({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), color: ['#e8792b', '#d9b24a', '#8a8f96'][i], width: [0.19, 0.13, 0.1][i], opacity: [0.9, 0.7, 0.6][i] })));
      }).then((res) => { if (my === engToken) $('#eng-name').textContent = Engines.ENGINES[res.engine].name; }).catch(() => { });
    }
    const nav = { first: () => 0, prev: () => Math.max(0, ply - 1), next: () => Math.min(line.length, ply + 1), last: () => line.length };
    $$('[data-nav]').forEach((b) => b.onclick = () => { ply = nav[b.dataset.nav](); rebuild(); refresh(false); });
    const keys = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      const k = { ArrowLeft: 'prev', ArrowRight: 'next', ArrowUp: 'first', ArrowDown: 'last' }[e.key];
      if (k) { e.preventDefault(); ply = nav[k](); rebuild(); refresh(false); }
    };
    document.addEventListener('keydown', keys); App.cleanup.push(() => document.removeEventListener('keydown', keys));
    $('#flip').onclick = () => { board.flip(); runEngine(); };
    $('#undo').onclick = () => { if (ply) { line = line.slice(0, ply - 1); ply--; rebuild(); refresh(false); } };
    $('#reset').onclick = () => { startFen = Chess.START_FEN; line = []; ply = 0; rebuild(); refresh(false); };
    $('#eng-on').onchange = runEngine; $('#eng-sel').onchange = runEngine; $('#eng-lines').onchange = runEngine;
    $('#loadfen').onclick = () => { try { new Chess($('#fen').value); startFen = $('#fen').value.trim(); line = []; ply = 0; rebuild(); refresh(false); } catch (e) { App.toast(e.message, 'bad'); } };
    $('#loadpgn').onclick = () => {
      try { const r = Chess.parsePgn($('#pgn').value); startFen = r.game.startFen; line = r.game.history({ verbose: true }).map((m) => m.uci); ply = line.length; rebuild(); refresh(false); App.toast('PGN loaded: ' + line.length + ' plies'); }
      catch (e) { App.toast(e.message, 'bad'); }
    };
    const fullGame = () => { const c = new Chess(startFen); line.forEach((u) => c.move(u)); return c; };
    const copy = (t, msg) => navigator.clipboard.writeText(t).then(() => App.toast(msg), () => App.toast('Copy failed', 'bad'));
    $('#copypgn').onclick = () => copy(fullGame().pgn({ Event: 'Analysis' }), 'PGN copied');
    $('#copyfen').onclick = () => copy(pos.fen(), 'FEN copied');
    $('#toreview').onclick = () => {
      if (!line.length) return App.toast('Make some moves first.', 'warn');
      const g = fullGame(); const id = App.history.add({ type: 'analysis', date: Date.now(), white: 'White', black: 'Black', result: '*', pgn: g.pgn() });
      App.go('/review/local/' + id);
    };
    $('#save').onclick = () => { const g = fullGame(); App.history.add({ type: 'analysis', date: Date.now(), white: 'White', black: 'Black', result: (g.result() || {}).result || '*', pgn: g.pgn() }); App.toast('Saved to your games'); };
    rebuild(); refresh(false);
  }
})();
