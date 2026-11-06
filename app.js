/*  IronForge Chess — app shell: router, header, auth screens, profiles,
    settings, admin panel and shared UI helpers.                          */
(function (root) {
  const App = (root.App = {
    backend: null, user: null, profile: null, routes: {}, cleanup: [],
    view: null,
  });

  /* ------------------------------ helpers ------------------------------ */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  App.esc = esc;
  App.$ = (sel, el) => (el || document).querySelector(sel);
  App.$$ = (sel, el) => [...(el || document).querySelectorAll(sel)];

  App.toast = function (msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 3600);
    setTimeout(() => t.remove(), 4200);
  };

  App.modal = function (html, opts) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal panel riveted">${opts && opts.title ? `<div class="panel-head"><h3>${esc(opts.title)}</h3><button class="x" data-close>✕</button></div>` : ''}<div class="modal-body">${html}</div></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    return { el: wrap, close };
  };

  App.confirm = function (text, okLabel) {
    return new Promise((res) => {
      const m = App.modal(`<p>${esc(text)}</p><div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="cfm-ok">${esc(okLabel || 'Confirm')}</button></div>`, { title: 'Confirm' });
      m.el.querySelector('#cfm-ok').onclick = () => { m.close(); res(true); };
      m.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) res(false); });
    });
  };

  App.isAdmin = (p) => Backend.isAdmin(p);

  const MOD_BADGE = `<span class="mod-badge" title="Site moderator"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5z" fill="currentColor"/><path d="m10.2 15.6-3.4-3.4 1.4-1.4 2 2 5.6-5.6 1.4 1.4z" fill="#1a1205"/></svg>MOD</span>`;
  App.MOD_BADGE = MOD_BADGE;

  /** Username with link and MOD badge for the moderator. */
  App.nameHtml = function (name, opts) {
    if (!name) return '<span class="muted">Waiting…</span>';
    const admin = String(name).toLowerCase() === Backend.ADMIN;
    const link = opts && opts.nolink ? `<span class="uname">${esc(name)}</span>` : `<a class="uname" href="#/u/${encodeURIComponent(name)}">${esc(name)}</a>`;
    return link + (admin ? MOD_BADGE : '');
  };

  const FRAMES = { iron: 'Iron', brass: 'Brass', ember: 'Ember', blood: 'Blood Red', steel: 'Blue Steel', toxic: 'Toxic' };
  App.FRAMES = FRAMES;
  App.avatarHtml = function (p, size) {
    size = size || 40;
    const name = (p && p.username) || '?';
    const frame = (p && p.frame) || 'iron';
    const inner = p && p.avatar
      ? `<img src="${esc(p.avatar)}" alt="">`
      : `<span class="initials" style="font-size:${Math.round(size * 0.42)}px">${esc(name.slice(0, 2).toUpperCase())}</span>`;
    return `<span class="avatar frame-${esc(frame)}" style="width:${size}px;height:${size}px">${inner}</span>`;
  };

  // cache of profiles by name (for avatars in lobby / games)
  const pcache = {};
  App.profileByName = async function (name) {
    if (!name) return null;
    const k = name.toLowerCase();
    if (pcache[k] && Date.now() - pcache[k].t < 60000) return pcache[k].p;
    const p = await App.backend.getProfileByName(name).catch(() => null);
    pcache[k] = { p, t: Date.now() };
    return p;
  };

  App.fmtEval = function (score) {
    if (!score) return '—';
    if (score.mate !== undefined) return (score.mate > 0 ? '+M' : score.mate < 0 ? '-M' : 'M') + Math.abs(score.mate || 0);
    if (score.cp >= 9000) return '1-0';
    if (score.cp <= -9000) return '0-1';
    const v = score.cp / 100;
    return (v > 0 ? '+' : '') + v.toFixed(2);
  };
  App.scoreCp = function (score) {
    if (!score) return 0;
    if (score.mate !== undefined) return score.mate > 0 ? 10000 - score.mate * 10 : score.mate < 0 ? -10000 - score.mate * 10 : 0;
    return score.cp;
  };
  App.winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1500, Math.min(1500, cp)))) - 1);

  App.uciToSan = function (fen, pv, max) {
    const c = new Chess(fen); const out = [];
    let num = parseInt(fen.split(' ')[5], 10), first = true;
    for (const u of pv.slice(0, max || 12)) {
      const white = c.turn === 'w';
      const m = c.move(u);
      if (!m) break;
      out.push((white ? num + '. ' : first ? num + '... ' : '') + m.san);
      if (!white) num++;
      first = false;
    }
    return out.join(' ');
  };

  /** Move list table. classes: optional array of classification per ply */
  App.moveListHtml = function (sans, cur, classes, startTurn, startNum) {
    startTurn = startTurn || 'w'; let num = startNum || 1;
    let html = '<div class="movelist">', i = 0;
    if (startTurn === 'b' && sans.length) { html += `<div class="mnum">${num}.</div><div class="mv empty">…</div>`; }
    for (; i < sans.length; i++) {
      const white = (i % 2 === 0) === (startTurn === 'w');
      if (white) html += `<div class="mnum">${num}.</div>`;
      const cls = classes && classes[i] ? ' c-' + classes[i] : '';
      html += `<div class="mv${i + 1 === cur ? ' cur' : ''}${cls}" data-ply="${i + 1}">${esc(sans[i])}${classes && classes[i] ? `<i class="ci ci-${classes[i]}"></i>` : ''}</div>`;
      if (!white) num++;
    }
    return html + '</div>';
  };

  /** Local saved-game history (bot games, analysis saves, finished online games) */
  App.history = {
    list() { try { return JSON.parse(localStorage.getItem('if_history')) || []; } catch (e) { return []; } },
    add(g) { const l = App.history.list(); g.id = g.id || Math.random().toString(36).slice(2); l.unshift(g); localStorage.setItem('if_history', JSON.stringify(l.slice(0, 200))); return g.id; },
    get(id) { return App.history.list().find((g) => g.id === id); },
    remove(id) { localStorage.setItem('if_history', JSON.stringify(App.history.list().filter((g) => g.id !== id))); },
  };

  App.requireLogin = function () {
    if (App.profile) return true;
    App.view.innerHTML = `<div class="panel riveted narrow center"><div class="panel-head"><h2>Sign in required</h2></div><div class="pad"><p>You need an account for this part of the forge.</p><a class="btn big" href="#/login">Sign in / Create account</a></div></div>`;
    return false;
  };

  /* ------------------------------ router ------------------------------ */
  App.route = function (pattern, fn) { App.routes[pattern] = fn; };
  App.go = (hash) => { location.hash = hash; };

  function runCleanup() { App.cleanup.forEach((f) => { try { f(); } catch (e) { } }); App.cleanup = []; Engines.stopAll(); }

  async function router() {
    runCleanup();
    const hash = location.hash.replace(/^#/, '').split('?')[0] || '/';
    const parts = hash.split('/').filter(Boolean);
    const key = '/' + (parts[0] || '');
    App.$$('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + key));
    // force username setup after first sign-in
    if (App.user && !App.profile && key !== '/welcome') return App.go('/welcome');
    const fn = App.routes[key] || App.routes['/404'];
    App.view.innerHTML = '';
    App.view.className = 'view view-' + (parts[0] || 'home');
    try { await fn(parts.slice(1).map(decodeURIComponent)); }
    catch (e) { console.error(e); App.view.innerHTML = `<div class="panel riveted narrow"><div class="pad"><h2>Something broke</h2><pre class="err">${esc(e.message)}</pre></div></div>`; }
    root.scrollTo(0, 0);
  }

  /* ------------------------------ header ------------------------------ */
  function renderHeader() {
    const p = App.profile;
    App.$('#userbox').innerHTML = p
      ? `<a class="userchip" href="#/profile">${App.avatarHtml(p, 34)}<span class="uc-name">${esc(p.username)}${App.isAdmin(p) ? MOD_BADGE : ''}</span></a>
         ${App.isAdmin(p) ? '<a class="btn small warn" href="#/admin">⚒ Admin</a>' : ''}
         <button class="btn small ghost" id="signout">Sign out</button>`
      : `<a class="btn small" href="#/login">Sign in</a>`;
    const so = App.$('#signout');
    if (so) so.onclick = async () => { await App.backend.signOut(); App.toast('Signed out'); App.go('/'); };
    App.$('#modebar').innerHTML = App.backend.mode === 'local'
      ? `<b>LOCAL MODE</b> — accounts &amp; games are saved in this browser only. ${root.__fbError ? 'Firebase error: ' + esc(root.__fbError) + '. ' : ''}<a href="https://github.com/" onclick="App.showSetupHelp();return false">Turn on real accounts</a>`
      : '';
    App.$('#modebar').classList.toggle('hidden', App.backend.mode !== 'local');
  }

  App.showSetupHelp = function () {
    App.modal(`<ol class="steps">
      <li>Create a free project at <b>console.firebase.google.com</b> and add a <b>Web app</b>.</li>
      <li>Paste its <code>firebaseConfig</code> into <code>js/config.js</code>.</li>
      <li>Authentication → Sign-in method: enable <b>Google</b>, <b>GitHub</b>, <b>Microsoft</b>, <b>Email/Password</b> and <b>Anonymous</b>.</li>
      <li>Authentication → Settings → Authorized domains: add <code>YOURNAME.github.io</code>.</li>
      <li>Create a <b>Firestore</b> database and paste <code>firestore.rules</code> (put your email in it).</li>
      <li>Push to GitHub. Sign in with your email and claim the username <b>Dorian</b>.</li></ol>
      <p class="muted">Full walkthrough is in README.md.</p>`, { title: 'Turn on real accounts' });
  };

  /* --------------------------- lock screen ---------------------------- */
  function renderLock() {
    const lock = App.$('#lockscreen');
    if (App.profile && App.profile.locked) {
      lock.innerHTML = `<div class="panel riveted lockpanel"><div class="panel-head danger"><h2>⛓ ACCOUNT LOCKED</h2></div><div class="pad">
        <p>Your account <b>${esc(App.profile.username)}</b> has been locked by a moderator.</p>
        <p class="lockreason">Reason: ${esc(App.profile.lockReason || 'No reason given')}</p>
        <p class="muted">If you think this is a mistake, contact the site owner.</p>
        <button class="btn" id="lock-out">Sign out</button></div></div>`;
      lock.classList.remove('hidden');
      App.$('#lock-out').onclick = () => App.backend.signOut();
    } else lock.classList.add('hidden');
  }

  /* ------------------------------- auth ------------------------------- */
  App.route('/login', async () => {
    if (App.profile) return App.go('/');
    const b = App.backend;
    const prov = (id, label, icon) => `<button class="btn provider p-${id}" data-prov="${id}" ${b.providerAvailable(id) ? '' : 'data-off="1"'}>${icon}<span>${label}</span></button>`;
    App.view.innerHTML = `<div class="auth-grid">
      <div class="panel riveted">
        <div class="panel-head"><h2>Enter the Forge</h2></div>
        <div class="pad">
          <div class="providers">
            ${prov('google', 'Continue with Google', '<svg viewBox="0 0 48 48" width="22"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>')}
            ${prov('github', 'Continue with GitHub', '<svg viewBox="0 0 24 24" width="22"><path fill="currentColor" d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z"/></svg>')}
            ${prov('microsoft', 'Continue with Microsoft', '<svg viewBox="0 0 24 24" width="20"><path fill="#f25022" d="M1 1h10v10H1z"/><path fill="#7fba00" d="M13 1h10v10H13z"/><path fill="#00a4ef" d="M1 13h10v10H1z"/><path fill="#ffb900" d="M13 13h10v10H13z"/></svg>')}
            ${prov('guest', 'Play as Guest', '<span class="pi">⚙</span>')}
          </div>
          <div class="divider"><span>or use email</span></div>
          <form id="email-form" class="form">
            <label>Email<input type="email" name="email" required autocomplete="email"></label>
            <label>Password<input type="password" name="pw" required minlength="6" autocomplete="current-password"></label>
            <div class="row">
              <button class="btn" type="submit" data-act="in">Sign in</button>
              <button class="btn ghost" type="submit" data-act="up">Create account</button>
              <button class="btn link" type="button" id="reset">Forgot password?</button>
            </div>
          </form>
          <p class="err" id="auth-err"></p>
        </div>
      </div>
      <div class="panel riveted auth-side">
        <div class="pad"><h3>Why sign in?</h3><ul class="bullets"><li>Play real opponents online</li><li>Custom profile picture &amp; frame</li><li>Your stats and game history</li></ul>
        ${b.mode === 'local' ? '<p class="note">Local mode: Google, GitHub and Microsoft buttons need Firebase. Email and Guest accounts work right now, saved in this browser.</p>' : ''}</div>
      </div></div>`;
    const err = App.$('#auth-err');
    const fail = (e) => { err.textContent = (e && e.message || String(e)).replace('Firebase: ', ''); };
    App.$$('[data-prov]').forEach((btn) => btn.onclick = async () => {
      err.textContent = '';
      try { if (btn.dataset.prov === 'guest') await b.signInGuest(); else await b.signInProvider(btn.dataset.prov); } catch (e) { fail(e); }
    });
    let act = 'in';
    App.$$('#email-form [data-act]').forEach((x) => x.onclick = () => { act = x.dataset.act; });
    App.$('#email-form').onsubmit = async (e) => {
      e.preventDefault(); err.textContent = '';
      const f = new FormData(e.target);
      try { if (act === 'up') await b.signUpEmail(f.get('email'), f.get('pw')); else await b.signInEmail(f.get('email'), f.get('pw')); } catch (x) { fail(x); }
    };
    App.$('#reset').onclick = async () => {
      const email = App.$('#email-form [name=email]').value;
      if (!email) return fail(new Error('Type your email first.'));
      try { await b.resetPassword(email); App.toast('Password reset email sent.'); } catch (x) { fail(x); }
    };
  });

  App.route('/welcome', async () => {
    if (!App.user) return App.go('/login');
    if (App.profile) return App.go('/');
    App.view.innerHTML = `<div class="panel riveted narrow"><div class="panel-head"><h2>Choose your name</h2></div><div class="pad">
      <p>This is how other players will see you. 3–20 letters, numbers or underscores. It can't be changed later.</p>
      <form id="name-form" class="form"><label>Username<input name="u" maxlength="20" required pattern="[A-Za-z0-9_]{3,20}" autofocus></label>
      <div class="row"><button class="btn big">Stamp it</button><button type="button" class="btn ghost" id="cancel-name">Sign out</button></div></form>
      <p class="err" id="name-err"></p></div></div>`;
    App.$('#cancel-name').onclick = () => App.backend.signOut();
    App.$('#name-form').onsubmit = async (e) => {
      e.preventDefault();
      const u = e.target.u.value.trim();
      try {
        App.profile = await App.backend.claimUsername(App.user, u);
        App.toast(`Welcome to the forge, ${u}!`);
        App.go(App.isAdmin(App.profile) ? '/admin' : '/');
      } catch (x) { App.$('#name-err').textContent = x.message; }
    };
  });

  /* ------------------------------ profile ----------------------------- */
  async function profileView(p, own) {
    const games = [];
    const unsub = App.backend.watchMyGames(p.uid, (list) => { games.length = 0; games.push(...list.filter((g) => g.status === 'over').slice(0, 15)); drawGames(); });
    App.cleanup.push(unsub);
    const st = p.stats || { w: 0, l: 0, d: 0 };
    const total = st.w + st.l + st.d;
    App.view.innerHTML = `<div class="profile-grid">
      <div class="panel riveted profile-card">
        <div class="pad center">
          <div class="pfp-wrap">${App.avatarHtml(p, 150)}</div>
          <h2 class="pname">${App.nameHtml(p.username, { nolink: true })}</h2>
          ${p.locked ? '<div class="tag danger">LOCKED</div>' : ''}
          <p class="bio">${esc(p.bio || (own ? 'No bio yet — add one below.' : ''))}</p>
          <div class="statrow"><div><b>${st.w}</b><span>Wins</span></div><div><b>${st.l}</b><span>Losses</span></div><div><b>${st.d}</b><span>Draws</span></div><div><b>${total ? Math.round((st.w + st.d / 2) / total * 100) : 0}%</b><span>Score</span></div></div>
          <p class="muted small">Joined ${new Date(p.createdAt).toLocaleDateString()} · via ${esc(p.provider || 'email')}</p>
        </div>
      </div>
      <div class="col">
        ${own ? `<div class="panel riveted"><div class="panel-head"><h3>Customize</h3></div><div class="pad">
          <div class="form">
            <label>Profile picture</label>
            <div class="row"><label class="btn file">Upload image<input type="file" id="pfp-file" accept="image/*" hidden></label>
            <button class="btn ghost" id="pfp-clear">Use initials</button></div>
            <div class="presets" id="presets"></div>
            <label>Frame</label>
            <div class="frames">${Object.entries(FRAMES).map(([k, v]) => `<button class="frame-pick frame-${k} ${p.frame === k ? 'on' : ''}" data-frame="${k}" title="${v}"><span></span>${v}</button>`).join('')}</div>
            <label>Bio<textarea id="bio" maxlength="160" rows="2">${esc(p.bio || '')}</textarea></label>
            <div class="row"><button class="btn" id="save-bio">Save bio</button></div>
          </div></div></div>` : ''}
        <div class="panel riveted"><div class="panel-head"><h3>Recent online games</h3></div><div class="pad" id="pgames"><p class="muted">Loading…</p></div></div>
      </div></div>`;
    function drawGames() {
      const el = App.$('#pgames'); if (!el) return;
      el.innerHTML = games.length ? `<table class="tbl">${games.map((g) => {
        const white = g.white === p.uid, res = g.result;
        const won = (res === '1-0' && white) || (res === '0-1' && !white);
        const draw = res === '1/2-1/2';
        return `<tr><td><span class="res ${won ? 'win' : draw ? 'draw' : 'loss'}">${won ? 'W' : draw ? 'D' : 'L'}</span></td><td>vs ${App.nameHtml(white ? g.blackName : g.whiteName)}</td><td class="muted">${esc(g.reason || '')}</td><td><a href="#/game/${g.id}">view</a> · <a href="#/review/online/${g.id}">review</a></td></tr>`;
      }).join('')}</table>` : '<p class="muted">No finished online games yet.</p>';
    }
    drawGames();
    if (!own) return;
    const save = async (fields, msg) => {
      try { await App.backend.updateProfile(p.uid, fields); Object.assign(p, fields); App.toast(msg || 'Saved'); router(); }
      catch (e) { App.toast(e.message, 'bad'); }
    };
    // preset generated avatars (forged emblems)
    const presets = ['♞', '♜', '♛', '♚', '⚒', '☠', '⚙', '🔥'];
    const colors = [['#5a1a0a', '#e8792b'], ['#1d2a3a', '#8fb3d9'], ['#2b2b2b', '#c9a24a'], ['#3a0d0d', '#ff4d3d'], ['#173018', '#8ad36c'], ['#2a1a3a', '#c79bff'], ['#3a2a10', '#ffd27a'], ['#101010', '#ff8a1f']];
    App.$('#presets').innerHTML = presets.map((s, i) => `<button class="preset" data-i="${i}" style="background:linear-gradient(160deg,${colors[i][0]},#000)"><span style="color:${colors[i][1]}">${s}</span></button>`).join('');
    App.$$('.preset').forEach((b) => b.onclick = () => {
      const i = +b.dataset.i, c = document.createElement('canvas'); c.width = c.height = 160;
      const x = c.getContext('2d');
      const gr = x.createLinearGradient(0, 0, 160, 160); gr.addColorStop(0, colors[i][0]); gr.addColorStop(1, '#000');
      x.fillStyle = gr; x.fillRect(0, 0, 160, 160);
      x.fillStyle = colors[i][1]; x.font = 'bold 104px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.shadowColor = colors[i][1]; x.shadowBlur = 18; x.fillText(presets[i], 80, 88);
      save({ avatar: c.toDataURL('image/png') }, 'Profile picture updated');
    });
    App.$('#pfp-file').onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      const img = new Image();
      img.onload = () => {
        const s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 160;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
        save({ avatar: c.toDataURL('image/jpeg', 0.85) }, 'Profile picture updated');
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => App.toast('Could not read that image.', 'bad');
      img.src = URL.createObjectURL(file);
    };
    App.$('#pfp-clear').onclick = () => save({ avatar: '' }, 'Using initials');
    App.$$('[data-frame]').forEach((b) => b.onclick = () => save({ frame: b.dataset.frame }, 'Frame updated'));
    App.$('#save-bio').onclick = () => save({ bio: App.$('#bio').value.slice(0, 160) }, 'Bio saved');
  }

  App.route('/profile', async () => { if (!App.requireLogin()) return; await profileView(App.profile, true); });
  App.route('/u', async ([name]) => {
    const p = await App.backend.getProfileByName(name);
    if (!p) { App.view.innerHTML = `<div class="panel riveted narrow"><div class="pad"><h2>No player named “${esc(name)}”</h2></div></div>`; return; }
    await profileView(p, App.profile && App.profile.uid === p.uid);
  });

  /* ------------------------------ settings ---------------------------- */
  App.route('/settings', async () => {
    const theme = localStorage.getItem('if_theme') || 'walnut', pieces = localStorage.getItem('if_pieces') || 'classic';
    const themes = { walnut: 'Walnut & Maple', gunmetal: 'Gunmetal', rust: 'Rust Belt', field: 'Army Field', ice: 'Cold Steel' };
    App.view.innerHTML = `<div class="panel riveted narrow"><div class="panel-head"><h2>Workshop Settings</h2></div><div class="pad form">
      <label>Board</label><div class="themes">${Object.entries(themes).map(([k, v]) => `<button class="theme-pick ${k === theme ? 'on' : ''}" data-theme="${k}"><span class="sw theme-${k}"><i></i><i></i><i></i><i></i></span>${v}</button>`).join('')}</div>
      <label>Pieces</label><div class="themes">${Object.entries(Pieces.STYLES).map(([k, v]) => `<button class="piece-pick ${k === pieces ? 'on' : ''}" data-pieces="${k}"><img src="${Pieces.pieceSvg('wN', k)}"><img src="${Pieces.pieceSvg('bQ', k)}">${v.name}</button>`).join('')}</div>
      <label>Sound</label><div class="row"><button class="btn ${localStorage.getItem('if_sound') === 'off' ? 'ghost' : ''}" id="snd">${localStorage.getItem('if_sound') === 'off' ? 'Sound OFF' : 'Sound ON'}</button></div>
      <div class="board-preview" id="bprev"></div></div></div>`;
    const prev = new Board(App.$('#bprev'), { movable: () => false });
    prev.setPosition(new Chess('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'), { from: 'g8', to: 'f6' });
    App.$$('[data-theme]').forEach((b) => b.onclick = () => { localStorage.setItem('if_theme', b.dataset.theme); applyTheme(); router(); });
    App.$$('[data-pieces]').forEach((b) => b.onclick = () => { localStorage.setItem('if_pieces', b.dataset.pieces); router(); });
    App.$('#snd').onclick = () => { localStorage.setItem('if_sound', localStorage.getItem('if_sound') === 'off' ? 'on' : 'off'); router(); };
  });
  function applyTheme() { document.body.dataset.board = localStorage.getItem('if_theme') || 'walnut'; }

  /* ------------------------------- admin ------------------------------ */
  App.route('/admin', async () => {
    if (!App.requireLogin()) return;
    if (!App.isAdmin(App.profile)) {
      App.view.innerHTML = `<div class="panel riveted narrow"><div class="panel-head danger"><h2>Restricted</h2></div><div class="pad"><p>The admin panel is for the site moderator only.</p></div></div>`;
      return;
    }
    App.view.innerHTML = `<div class="panel riveted"><div class="panel-head warnhead"><h2>⚒ Moderator Control Room</h2><span class="muted">Signed in as ${App.nameHtml(App.profile.username, { nolink: true })}</span></div>
      <div class="pad"><div class="admin-stats" id="astats"></div>
      <div class="row"><input id="asearch" placeholder="Search players…" class="grow"><select id="afilter"><option value="all">All players</option><option value="locked">Locked only</option><option value="active">Active only</option></select><button class="btn ghost" id="arefresh">↻ Refresh</button></div>
      <div id="atable" class="tblwrap"></div></div></div>`;
    let users = [];
    const load = async () => { try { users = await App.backend.listUsers(); draw(); } catch (e) { App.$('#atable').innerHTML = `<p class="err">${esc(e.message)}</p>`; } };
    const draw = () => {
      const q = App.$('#asearch').value.toLowerCase(), f = App.$('#afilter').value;
      const list = users.filter((u) => (!q || u.usernameLower.includes(q)) && (f === 'all' || (f === 'locked' ? u.locked : !u.locked)));
      App.$('#astats').innerHTML = `<div><b>${users.length}</b><span>Players</span></div><div><b>${users.filter((u) => u.locked).length}</b><span>Locked</span></div><div><b>${users.filter((u) => u.provider === 'guest').length}</b><span>Guests</span></div>`;
      App.$('#atable').innerHTML = `<table class="tbl admin"><thead><tr><th></th><th>Player</th><th>Joined</th><th>Sign-in</th><th>Record</th><th>Status</th><th>Action</th></tr></thead><tbody>${list.map((u) => {
        const s = u.stats || { w: 0, l: 0, d: 0 }, me = u.uid === App.profile.uid;
        return `<tr class="${u.locked ? 'locked' : ''}"><td>${App.avatarHtml(u, 32)}</td><td>${App.nameHtml(u.username)}</td><td>${new Date(u.createdAt).toLocaleDateString()}</td><td>${esc(u.provider || '')}</td><td>${s.w}/${s.l}/${s.d}</td>
          <td>${u.locked ? `<span class="tag danger" title="${esc(u.lockReason)}">LOCKED</span><div class="muted small">${esc(u.lockReason)}</div>` : '<span class="tag ok">ACTIVE</span>'}</td>
          <td>${me ? '<span class="muted">you</span>' : u.locked ? `<button class="btn small" data-unlock="${u.uid}">Unlock</button>` : `<button class="btn small danger" data-lock="${u.uid}">Lock</button>`}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">No players match.</td></tr>'}</tbody></table>`;
      App.$$('[data-lock]').forEach((b) => b.onclick = () => {
        const u = users.find((x) => x.uid === b.dataset.lock);
        const m = App.modal(`<p>Lock <b>${esc(u.username)}</b>? They will be signed into a lock screen and blocked from playing.</p>
          <label class="form">Reason (shown to the player)<input id="lreason" value="Violation of site rules"></label>
          <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="dolock">⛓ Lock account</button></div>`, { title: 'Lock account' });
        m.el.querySelector('#dolock').onclick = async () => {
          try { await App.backend.setLocked(App.profile.uid, u.uid, true, m.el.querySelector('#lreason').value); m.close(); App.toast(u.username + ' locked'); load(); }
          catch (e) { App.toast(e.message, 'bad'); }
        };
      });
      App.$$('[data-unlock]').forEach((b) => b.onclick = async () => {
        try { await App.backend.setLocked(App.profile.uid, b.dataset.unlock, false); App.toast('Account unlocked'); load(); } catch (e) { App.toast(e.message, 'bad'); }
      });
    };
    App.$('#asearch').oninput = draw; App.$('#afilter').onchange = draw; App.$('#arefresh').onclick = load;
    load();
  });

  /* -------------------------------- home ------------------------------ */
  App.route('/', async () => {
    const hist = App.history.list().slice(0, 6);
    App.view.innerHTML = `
      <section class="hero panel riveted"><div class="hero-inner">
        <div><h1>IRONFORGE <span>CHESS</span></h1><p class="tag-line">Free chess. Real engines. No fluff. Hammer out your game against bots, rivals and Stockfish itself.</p>
        <div class="row"><a class="btn big" href="#/play">⚔ Play a Bot</a><a class="btn big alt" href="#/online">🌐 Play Online</a><a class="btn big ghost" href="#/analysis">🔍 Analyze</a></div></div>
        <div class="hero-board" id="hero-board"></div></div></section>
      <section class="cards">
        <a class="card panel riveted" href="#/play"><div class="card-ico">♞</div><h3>Bot Arena</h3><p>8 opponents from Pawnstorm Pete to full-strength Stockfish.</p></a>
        <a class="card panel riveted" href="#/online"><div class="card-ico">⚔</div><h3>Online Games</h3><p>Open a challenge, share the link, play live with clocks and chat.</p></a>
        <a class="card panel riveted" href="#/analysis"><div class="card-ico">⚙</div><h3>Analysis Board</h3><p>Stockfish 10 and Ironclad engines, multi-line eval, FEN & PGN.</p></a>
        <a class="card panel riveted" href="#/review"><div class="card-ico">✎</div><h3>Game Review</h3><p>Accuracy scores, blunders, brilliant moves and an eval graph.</p></a>
      </section>
      <section class="panel riveted"><div class="panel-head"><h3>Your recent games</h3><a href="#/review" class="btn small ghost">Review a game</a></div><div class="pad">
        ${hist.length ? `<table class="tbl">${hist.map((g) => `<tr><td>${esc(g.white)} vs ${esc(g.black)}</td><td><b>${esc(g.result)}</b></td><td class="muted">${esc(g.type || '')} · ${new Date(g.date).toLocaleDateString()}</td><td><a href="#/review/local/${g.id}">Review</a> · <a href="#/analysis/local/${g.id}">Analyze</a></td></tr>`).join('')}</table>` : '<p class="muted">No games yet. Go break something.</p>'}
      </div></section>`;
    // animated hero board playing a famous game
    const hb = new Board(App.$('#hero-board'), { movable: () => false, coords: false });
    const opera = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ');
    let c = new Chess(), i = 0;
    hb.setPosition(c);
    const tick = setInterval(() => {
      if (i >= opera.length) { c = new Chess(); i = 0; hb.setPosition(c); return; }
      const m = c.move(opera[i++]); hb.setPosition(c, m);
    }, 1100);
    App.cleanup.push(() => clearInterval(tick));
  });

  App.route('/404', async () => { App.view.innerHTML = '<div class="panel riveted narrow"><div class="pad"><h2>Nothing here</h2><a href="#/">Back to the forge</a></div></div>'; });

  /* ------------------------------- boot ------------------------------- */
  async function boot() {
    App.view = App.$('#view');
    applyTheme();
    App.view.innerHTML = '<div class="loading">Heating the forge…</div>';
    App.backend = await Backend.create();
    let first = true;
    App.backend.onAuth((user, profile) => {
      const prevUid = App.user && App.user.uid, prevProfile = !!App.profile, prevLocked = App.profile && App.profile.locked;
      App.user = user; App.profile = profile;
      renderHeader(); renderLock();
      const hash = location.hash;
      if (first) { first = false; router(); return; }
      if ((user && user.uid) !== prevUid || prevProfile !== !!profile) {
        if (user && !profile) App.go('/welcome');
        else if (user && /login|welcome/.test(hash)) App.go(App.isAdmin(profile) ? '/admin' : '/');
        else router();
      } else if (prevLocked !== (profile && profile.locked)) renderLock();
    });
    root.addEventListener('hashchange', router);
    root.addEventListener('engine-fallback', (e) => App.toast('Stockfish unavailable — using Ironclad instead. (' + e.detail + ')', 'warn'));
  }
  document.addEventListener('DOMContentLoaded', boot);
})(window);
