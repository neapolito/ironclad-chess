/*  Bot arena: pick an opponent, play, take back, get hints, then review. */
(function () {
  const { esc, $, $$ } = App;

  App.route('/play', async ([botId]) => {
    if (!botId) return botPicker();
    const bot = Engines.BOTS.find((b) => b.id === botId);
    if (!bot) return App.go('/play');
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    let color = params.get('c') || 'w';
    if (color === 'r') color = Math.random() < 0.5 ? 'w' : 'b';
    botGame(bot, color);
  });

  function botPicker() {
    App.view.innerHTML = `<div class="panel riveted"><div class="panel-head"><h2>Bot Arena</h2><span class="muted">Choose your opponent</span></div>
      <div class="pad"><div class="row colorpick"><span>Play as:</span>
        <label><input type="radio" name="col" value="w" checked> <img src="${Pieces.pieceSvg('wK', localStorage.getItem('if_pieces'))}"> White</label>
        <label><input type="radio" name="col" value="b"> <img src="${Pieces.pieceSvg('bK', localStorage.getItem('if_pieces'))}"> Black</label>
        <label><input type="radio" name="col" value="r"> 🎲 Random</label></div>
      <div class="bots">${Engines.BOTS.map((b) => `<button class="bot panel" data-bot="${b.id}" style="--bc:${b.color}">
        <div class="bot-face">${b.engine === 'stockfish' ? '🐟' : ['♟', '⚙', '⚒', '♜', '🔥'][Engines.BOTS.indexOf(b)] || '♞'}</div>
        <div class="bot-info"><h3>${esc(b.name)}</h3><div class="elo">${esc(b.elo)} <span class="tag">${b.engine === 'stockfish' ? 'STOCKFISH' : 'IRONCLAD'}</span></div><p>${esc(b.blurb)}</p></div></button>`).join('')}</div></div></div>`;
    $$('[data-bot]').forEach((b) => b.onclick = () => App.go(`/play/${b.dataset.bot}?c=${$('input[name=col]:checked').value}`));
  }

  function botGame(bot, color) {
    const me = App.profile ? App.profile.username : 'You';
    App.view.innerHTML = `<div class="game-layout">
      <div class="board-col">
        <div class="player-strip top"><div class="ps-left"><span class="avatar bot-av" style="background:${bot.color}">${bot.engine === 'stockfish' ? '🐟' : '⚙'}</span><b>${esc(bot.name)}</b> <span class="muted">${esc(bot.elo)}</span></div><div class="thinking hidden" id="thinking">thinking<i>.</i><i>.</i><i>.</i></div></div>
        <div class="board-frame"><div id="board"></div></div>
        <div class="player-strip bottom"><div class="ps-left">${App.profile ? App.avatarHtml(App.profile, 30) : '<span class="avatar"><span class="initials">YO</span></span>'}<b>${App.profile ? App.nameHtml(me) : 'You'}</b></div></div>
      </div>
      <div class="side-col">
        <div class="panel riveted"><div class="panel-head"><h3>vs ${esc(bot.name)}</h3><span class="status" id="status"></span></div>
          <div class="pad"><div id="moves"></div>
          <div class="btnbar">
            <button class="btn small" id="undo" title="Take back">↶ Takeback</button>
            <button class="btn small" id="hint" title="Show best move">💡 Hint</button>
            <button class="btn small ghost" id="flip">⇅ Flip</button>
            <button class="btn small danger" id="resign">⚑ Resign</button>
          </div>
          <div id="after" class="hidden"><div class="result-banner" id="result"></div>
            <div class="btnbar"><button class="btn" id="review">✎ Review game</button><button class="btn ghost" id="again">↻ Rematch</button><a class="btn ghost" href="#/play">Other bots</a></div></div>
          </div></div>
      </div></div>`;
    const chess = new Chess();
    let over = false, last = null, saved = false, token = 0;
    const board = new Board($('#board'), {
      orientation: color,
      movable: (c) => c === color && !over,
      onMove: (from, to, promo) => {
        const m = chess.move({ from, to, promotion: promo });
        if (!m) return;
        last = m; board.setArrows([]); update(true);
        if (!checkEnd()) botMove();
      },
    });
    function update(sound) {
      board.setPosition(chess, last, { sound });
      $('#moves').innerHTML = App.moveListHtml(chess.history(), chess.history().length);
      const ml = $('#moves .movelist'); if (ml) ml.scrollTop = ml.scrollHeight;
      $('#status').textContent = over ? 'Game over' : chess.turn === color ? 'Your move' : 'Bot to move';
    }
    function finish(result, reason) {
      over = true; Engines.stopAll(); $('#thinking').classList.add('hidden');
      const won = (result === '1-0' && color === 'w') || (result === '0-1' && color === 'b');
      $('#result').innerHTML = `<b>${result === '1/2-1/2' ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT'}</b><span>${esc(result)} · ${esc(reason)}</span>`;
      $('#result').className = 'result-banner ' + (result === '1/2-1/2' ? 'draw' : won ? 'win' : 'loss');
      $('#after').classList.remove('hidden');
      $('#review').classList.toggle('hidden', !saved && chess.history().length < 2);
      if (!saved && chess.history().length >= 2) {
        saved = App.history.add({ type: 'bot', date: Date.now(), white: color === 'w' ? me : bot.name, black: color === 'w' ? bot.name : me, result, reason, pgn: chess.pgn({ White: color === 'w' ? me : bot.name, Black: color === 'w' ? bot.name : me, Result: result }) });
      }
      $('#review').classList.toggle('hidden', !saved);
      update(false); boardSound('end');
    }
    function checkEnd() { const r = chess.result(); if (r) { finish(r.result, r.reason); return true; } return false; }
    async function botMove() {
      const my = ++token;
      $('#thinking').classList.remove('hidden'); update(false);
      const t0 = Date.now();
      try {
        const res = await Engines.analyze(bot.engine, { fen: chess.fen(), history: [...chess.reps.keys()].filter((k) => k !== chess.posKey()), depth: bot.depth, movetime: bot.movetime, noise: bot.noise, blunder: bot.blunder, skill: bot.skill, multipv: bot.noise ? 4 : 1 });
        await new Promise((r) => setTimeout(r, Math.max(0, 350 - (Date.now() - t0))));
        if (my !== token || over) return;
        if (res.move) { last = chess.move(res.move); }
      } catch (e) { if (e.message !== 'stopped') App.toast('Engine error: ' + e.message, 'bad'); return; }
      $('#thinking').classList.add('hidden');
      update(true); checkEnd();
    }
    $('#flip').onclick = () => board.flip();
    $('#undo').onclick = () => {
      if (over) return;
      token++; Engines.stopAll(); $('#thinking').classList.add('hidden');
      chess.undo(); if (chess.turn !== color) chess.undo();
      const h = chess.history({ verbose: true }); last = h[h.length - 1] || null; update(false);
      if (chess.turn !== color) botMove();
    };
    $('#hint').onclick = async () => {
      if (over || chess.turn !== color) return;
      $('#hint').disabled = true;
      try {
        const r = await Engines.analyze('ironclad', { fen: chess.fen(), movetime: 1200 });
        if (r.move) board.setArrows([{ from: r.move.slice(0, 2), to: r.move.slice(2, 4), color: '#4fd16a' }]);
      } catch (e) { }
      $('#hint').disabled = false;
    };
    $('#resign').onclick = async () => { if (!over && await App.confirm('Resign this game?', 'Resign')) finish(color === 'w' ? '0-1' : '1-0', 'resignation'); };
    $('#review').onclick = () => App.go('/review/local/' + saved);
    $('#again').onclick = () => { location.hash = `#/play/${bot.id}?c=${color === 'w' ? 'b' : 'w'}&t=${Date.now()}`; };
    update(false);
    if (color === 'b') botMove();
  }
})();
