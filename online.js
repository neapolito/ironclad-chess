/*  Online play: lobby with open challenges, live games with clocks,
    draw offers, resign/abort, chat and spectating via shared links.   */
(function () {
  const { esc, $, $$ } = App;
  const TCS = [{ min: 0, inc: 0, label: 'Untimed' }, { min: 1, inc: 0, label: '1+0 Bullet' }, { min: 3, inc: 2, label: '3+2 Blitz' }, { min: 5, inc: 0, label: '5+0 Blitz' },
    { min: 10, inc: 0, label: '10+0 Rapid' }, { min: 15, inc: 10, label: '15+10 Rapid' }, { min: 30, inc: 0, label: '30+0 Classical' }];
  const tcLabel = (tc) => (TCS.find((t) => t.min === tc.min && t.inc === tc.inc) || { label: `${tc.min}+${tc.inc}` }).label;
  const fmtClock = (ms) => { ms = Math.max(0, ms); const s = Math.ceil(ms / 1000); const m = Math.floor(s / 60); return ms < 10000 ? (ms / 1000).toFixed(1) : `${m}:${String(s % 60).padStart(2, '0')}`; };

  App.route('/online', async () => {
    if (!App.requireLogin()) return;
    App.view.innerHTML = `<div class="online-grid">
      <div class="panel riveted"><div class="panel-head"><h2>Open a Challenge</h2></div><div class="pad form">
        <label>Time control</label><div class="tcs">${TCS.map((t, i) => `<button class="tc ${i === 3 ? 'on' : ''}" data-tc="${i}">${t.label}</button>`).join('')}</div>
        <label>Your color</label><div class="row colorpick">
          <label><input type="radio" name="oc" value="w"> White</label><label><input type="radio" name="oc" value="random" checked> Random</label><label><input type="radio" name="oc" value="b"> Black</label></div>
        <button class="btn big" id="create">⚔ Create challenge</button>
        ${App.backend.mode === 'local' ? '<p class="note">Local mode: online games only work between tabs of this browser. Turn on Firebase to play anyone, anywhere.</p>' : '<p class="muted small">Anyone in the lobby can accept, or share the game link with a friend.</p>'}
      </div></div>
      <div class="panel riveted"><div class="panel-head"><h2>Lobby</h2><span class="live-dot">LIVE</span></div><div class="pad" id="lobby"><p class="muted">Loading…</p></div></div>
      <div class="panel riveted wide"><div class="panel-head"><h2>Your games</h2></div><div class="pad" id="mine"><p class="muted">Loading…</p></div></div></div>`;
    let tc = TCS[3];
    $$('[data-tc]').forEach((b) => b.onclick = () => { $$('[data-tc]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); tc = TCS[+b.dataset.tc]; });
    $('#create').onclick = async () => {
      try {
        const id = await App.backend.createGame(App.profile.uid, App.profile, $('input[name=oc]:checked').value, { min: tc.min, inc: tc.inc });
        App.go('/game/' + id);
      } catch (e) { App.toast(e.message, 'bad'); }
    };
    App.cleanup.push(App.backend.watchOpenGames(async (list) => {
      const el = $('#lobby'); if (!el) return;
      if (!list.length) { el.innerHTML = '<p class="muted">No open challenges. Create one!</p>'; return; }
      el.innerHTML = `<table class="tbl lobby">${list.map((g) => `<tr><td class="av" data-av="${esc(g.creatorName)}"></td><td>${App.nameHtml(g.creatorName)}</td><td>${tcLabel(g.tc)}</td><td>${g.white ? 'plays White' : 'plays Black'}</td>
        <td>${g.createdBy === App.profile.uid ? `<a class="btn small ghost" href="#/game/${g.id}">Waiting…</a>` : `<button class="btn small" data-join="${g.id}">Accept</button>`}</td></tr>`).join('')}</table>`;
      $$('[data-join]').forEach((b) => b.onclick = async () => { try { await App.backend.joinGame(b.dataset.join, App.profile.uid, App.profile); App.go('/game/' + b.dataset.join); } catch (e) { App.toast(e.message, 'bad'); } });
      for (const td of $$('[data-av]', el)) { const p = await App.profileByName(td.dataset.av); td.innerHTML = App.avatarHtml(p || { username: td.dataset.av }, 30); }
    }));
    App.cleanup.push(App.backend.watchMyGames(App.profile.uid, (list) => {
      const el = $('#mine'); if (!el) return;
      if (!list.length) { el.innerHTML = '<p class="muted">No online games yet.</p>'; return; }
      el.innerHTML = `<table class="tbl">${list.slice(0, 30).map((g) => {
        const opp = g.white === App.profile.uid ? g.blackName : g.whiteName;
        return `<tr><td><span class="tag ${g.status === 'active' ? 'ok' : g.status === 'open' ? 'warn' : ''}">${g.status.toUpperCase()}</span></td><td>vs ${opp ? App.nameHtml(opp) : '<span class="muted">waiting for opponent</span>'}</td><td>${tcLabel(g.tc)}</td><td>${g.result ? `<b>${esc(g.result)}</b> <span class="muted">${esc(g.reason)}</span>` : ''}</td><td><a class="btn small" href="#/game/${g.id}">${g.status === 'over' ? 'View' : 'Open'}</a>${g.status === 'over' ? ` <a class="btn small ghost" href="#/review/online/${g.id}">Review</a>` : ''}</td></tr>`;
      }).join('')}</table>`;
    }));
  });

  App.route('/game', async ([id]) => {
    App.view.innerHTML = `<div class="game-layout">
      <div class="board-col">
        <div class="player-strip top" id="ps-top"></div>
        <div class="board-frame"><div id="board"></div></div>
        <div class="player-strip bottom" id="ps-bot"></div>
      </div>
      <div class="side-col">
        <div class="panel riveted"><div class="panel-head"><h3 id="g-title">Online game</h3><span class="status" id="status"></span></div>
          <div class="pad"><div id="g-banner"></div><div id="moves"></div>
            <div class="btnbar" id="g-actions"></div></div></div>
        <div class="panel riveted"><div class="panel-head"><h3>Chat</h3></div><div class="pad"><div class="chat" id="chat"></div>
          <form class="row" id="chatf"><input id="chatin" class="grow" maxlength="200" placeholder="Say something…"><button class="btn small">Send</button></form></div></div>
      </div></div>`;
    let game = null, chess = new Chess(), last = null, board = null, myColor = null, lastLen = -1, pending = false, endSounded = false, statsDone = false;
    const me = App.profile && App.profile.uid;
    board = new Board($('#board'), {
      movable: (c) => game && game.status === 'active' && c === myColor && !pending,
      onMove: async (from, to, promo) => {
        const m = chess.move({ from, to, promotion: promo });
        if (!m) return;
        last = m; board.setPosition(chess, m, { sound: true }); pending = true;
        try { await App.backend.move(id, me, m.uci); } catch (e) { App.toast(e.message, 'bad'); lastLen = -2; render(); }
        pending = false;
      },
    });
    const avatars = {};
    async function strip(el, color) {
      const name = color === 'w' ? game.whiteName : game.blackName;
      const ms = clockFor(color);
      const p = name ? (avatars[name] || (avatars[name] = await App.profileByName(name))) : null;
      el.innerHTML = `<div class="ps-left">${App.avatarHtml(p || { username: name || '?' }, 34)}<b>${App.nameHtml(name)}</b><span class="muted">${color === 'w' ? 'White' : 'Black'}</span></div>
        ${game.tc && game.tc.min ? `<div class="clock ${game.status === 'active' && chess.turn === color ? 'running' : ''} ${ms < 20000 ? 'low' : ''}" data-clock="${color}">${fmtClock(ms)}</div>` : ''}`;
    }
    function clockFor(color) {
      if (!game.tc || !game.tc.min) return 0;
      let ms = color === 'w' ? game.whiteMs : game.blackMs;
      if (game.status === 'active' && chess.turn === color && game.moves.length >= 2) ms -= Date.now() - game.lastMoveAt;
      return ms;
    }
    async function render() {
      if (!game) return;
      myColor = game.white === me ? 'w' : game.black === me ? 'b' : null;
      if (game.moves.length !== lastLen) {
        chess = new Chess(); last = null;
        game.moves.forEach((u) => { last = chess.move(u); });
        board.setPosition(chess, last, { sound: lastLen >= 0 && game.moves.length > lastLen && last && last.color !== myColor });
        lastLen = game.moves.length;
      }
      board.setOrientation(myColor || 'w');
      const top = board.orientation === 'w' ? 'b' : 'w';
      await strip($('#ps-top'), top); await strip($('#ps-bot'), top === 'w' ? 'b' : 'w');
      $('#g-title').textContent = `${tcLabel(game.tc)} · ${myColor ? 'You are ' + (myColor === 'w' ? 'White' : 'Black') : 'Spectating'}`;
      $('#status').textContent = game.status === 'open' ? 'Waiting' : game.status === 'active' ? (chess.turn === myColor ? 'Your move' : (chess.turn === 'w' ? 'White' : 'Black') + ' to move') : 'Finished';
      $('#moves').innerHTML = App.moveListHtml(chess.history(), chess.history().length);
      const ml = $('#moves .movelist'); if (ml) ml.scrollTop = ml.scrollHeight;
      // banner
      let banner = '';
      if (game.status === 'open') {
        const link = location.href.split('#')[0] + '#/game/' + id;
        banner = `<div class="share"><p>Waiting for an opponent. Share this link:</p><div class="row"><input class="grow mono" readonly value="${esc(link)}" id="share"><button class="btn small" id="copylink">Copy</button></div>
          ${myColor ? '<button class="btn small ghost" id="cancel">Cancel challenge</button>' : App.profile ? '<button class="btn" id="join">Accept challenge</button>' : '<a class="btn" href="#/login">Sign in to accept</a>'}</div>`;
      } else if (game.status === 'over') {
        const won = myColor && ((game.result === '1-0' && myColor === 'w') || (game.result === '0-1' && myColor === 'b'));
        const draw = game.result === '1/2-1/2';
        banner = `<div class="result-banner ${draw ? 'draw' : myColor ? (won ? 'win' : 'loss') : ''}"><b>${draw ? 'DRAW' : myColor ? (won ? 'VICTORY' : 'DEFEAT') : game.result === '1-0' ? 'WHITE WINS' : 'BLACK WINS'}</b><span>${esc(game.result)} · ${esc(game.reason)}</span></div>`;
        if (!endSounded && lastLen >= 0) { endSounded = true; boardSound('end'); }
        recordStats();
      } else if (game.drawOffer && game.drawOffer !== myColor && myColor) {
        banner = `<div class="offer">Your opponent offers a draw. <button class="btn small" id="acc-draw">Accept</button><button class="btn small ghost" id="dec-draw">Decline</button></div>`;
      } else if (game.drawOffer && game.drawOffer === myColor) banner = '<div class="offer muted">Draw offered…</div>';
      $('#g-banner').innerHTML = banner;
      // actions
      let acts = '<button class="btn small ghost" id="flip">⇅ Flip</button>';
      if (game.status === 'active' && myColor) {
        acts += game.moves.length < 2 ? '<button class="btn small" id="abort">✕ Abort</button>' : '<button class="btn small" id="draw">½ Offer draw</button>';
        acts += '<button class="btn small danger" id="resign">⚑ Resign</button>';
      }
      if (game.status === 'over') acts += `<a class="btn small" href="#/review/online/${id}">✎ Review</a><a class="btn small ghost" href="#/online">Lobby</a>`;
      $('#g-actions').innerHTML = acts;
      bind();
      // chat
      $('#chat').innerHTML = (game.chat || []).map((c) => `<div class="msg"><b>${App.nameHtml(c.n)}</b> ${esc(c.t)}</div>`).join('') || '<p class="muted small">No messages.</p>';
      $('#chat').scrollTop = 1e9;
    }
    function bind() {
      const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
      on('#flip', () => board.flip());
      on('#copylink', () => { $('#share').select(); navigator.clipboard.writeText($('#share').value).then(() => App.toast('Link copied')); });
      on('#cancel', async () => { await App.backend.cancelGame(id); App.go('/online'); });
      on('#join', async () => { try { await App.backend.joinGame(id, me, App.profile); } catch (e) { App.toast(e.message, 'bad'); } });
      const patch = (fn) => App.backend.patchGame(id, me, fn).catch((e) => App.toast(e.message, 'bad'));
      on('#resign', async () => { if (await App.confirm('Resign this game?', 'Resign')) patch((g) => g.status === 'active' ? { status: 'over', result: myColor === 'w' ? '0-1' : '1-0', reason: 'resignation', updatedAt: Date.now() } : {}); });
      on('#abort', () => patch((g) => g.status === 'active' && g.moves.length < 2 ? { status: 'over', result: '*', reason: 'aborted', updatedAt: Date.now() } : {}));
      on('#draw', () => patch(() => ({ drawOffer: myColor })));
      on('#acc-draw', () => patch((g) => g.status === 'active' && g.drawOffer && g.drawOffer !== myColor ? { status: 'over', result: '1/2-1/2', reason: 'agreement', drawOffer: null, updatedAt: Date.now() } : {}));
      on('#dec-draw', () => patch(() => ({ drawOffer: null })));
    }
    async function recordStats() {
      if (statsDone || !myColor || !game.result || game.result === '*') return;
      statsDone = true;
      const key = 'if_stats_' + id + '_' + me;
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
      const won = (game.result === '1-0' && myColor === 'w') || (game.result === '0-1' && myColor === 'b');
      const st = Object.assign({ w: 0, l: 0, d: 0 }, App.profile.stats);
      if (game.result === '1/2-1/2') st.d++; else if (won) st.w++; else st.l++;
      App.backend.updateProfile(me, { stats: st }).catch(() => { });
      App.history.add({ type: 'online', date: Date.now(), white: game.whiteName, black: game.blackName, result: game.result, reason: game.reason, pgn: chess.pgn({ White: game.whiteName, Black: game.blackName, Result: game.result }) });
    }
    $('#chatf').onsubmit = (e) => {
      e.preventDefault();
      const t = $('#chatin').value.trim(); if (!t || !game) return;
      if (!App.profile) return App.toast('Sign in to chat', 'warn');
      if (!myColor) return App.toast('Only players can chat', 'warn');
      App.backend.patchGame(id, me, (g) => ({ chat: (g.chat || []).concat({ n: App.profile.username, t: t.slice(0, 200), at: Date.now() }).slice(-100) })).catch((x) => App.toast(x.message, 'bad'));
      $('#chatin').value = '';
    };
    // clocks tick + flag detection
    const tick = setInterval(() => {
      if (!game || game.status !== 'active' || !game.tc || !game.tc.min) return;
      ['w', 'b'].forEach((c) => { const el = $(`[data-clock="${c}"]`); if (el) { const ms = clockFor(c); el.textContent = fmtClock(ms); el.classList.toggle('low', ms < 20000); } });
      const ms = clockFor(chess.turn);
      if (ms <= 0 && myColor && !game._flagSent) {
        game._flagSent = true;
        const loser = chess.turn;
        App.backend.patchGame(id, me, (g) => g.status === 'active' ? { status: 'over', result: loser === 'w' ? '0-1' : '1-0', reason: 'timeout', updatedAt: Date.now(), [loser === 'w' ? 'whiteMs' : 'blackMs']: 0 } : {}).catch(() => { });
      }
    }, 200);
    App.cleanup.push(() => clearInterval(tick));
    App.cleanup.push(App.backend.watchGame(id, (g) => {
      if (!g) { App.view.innerHTML = '<div class="panel riveted narrow"><div class="pad"><h2>Game not found</h2><a href="#/online">Back to lobby</a></div></div>'; return; }
      game = g; render();
    }));
  });
})();
