/*  Backend: accounts, profiles, moderation and online games.
    FirebaseBackend  -> real accounts (Google / GitHub / Microsoft / email / guest)
                        and real-time online games between any two browsers.
    LocalBackend     -> same API stored in this browser (demo mode; online games
                        work between tabs of the same browser).                    */
(function (root) {
  const CFG = root.IRONFORGE_CONFIG || {};
  const ADMIN = (CFG.adminUsername || 'Dorian').toLowerCase();
  const NAME_RE = /^[A-Za-z0-9_]{3,20}$/;
  const uid8 = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  function newProfile(uid, username, provider) {
    return {
      uid, username, usernameLower: username.toLowerCase(), avatar: '', frame: 'iron', bio: '',
      locked: false, lockReason: '', createdAt: Date.now(), provider: provider || 'email',
      stats: { w: 0, l: 0, d: 0 },
    };
  }

  function newGame(creator, profile, color, tc) {
    const seat = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
    const ms = tc && tc.min ? tc.min * 60000 : 0;
    return {
      white: seat === 'w' ? creator : null, black: seat === 'b' ? creator : null,
      whiteName: seat === 'w' ? profile.username : '', blackName: seat === 'b' ? profile.username : '',
      players: [creator], createdBy: creator, creatorName: profile.username,
      status: 'open', result: null, reason: null, moves: [], fen: Chess.START_FEN,
      tc: tc || { min: 0, inc: 0 }, whiteMs: ms, blackMs: ms, lastMoveAt: 0,
      drawOffer: null, chat: [], createdAt: Date.now(), updatedAt: Date.now(),
    };
  }

  /** Pure function: apply a move to a game object (shared by both backends). */
  function applyMove(g, uid, uci) {
    if (g.status !== 'active') throw new Error('Game is not active.');
    const c = new Chess();
    g.moves.forEach((m) => c.move(m));
    const turnUid = c.turn === 'w' ? g.white : g.black;
    if (turnUid !== uid) throw new Error("It's not your turn.");
    const mv = c.move(uci);
    if (!mv) throw new Error('Illegal move.');
    const now = Date.now();
    const out = { moves: g.moves.concat([mv.uci]), fen: c.fen(), drawOffer: null, updatedAt: now, lastMoveAt: now };
    if (g.tc && g.tc.min) {
      const key = mv.color === 'w' ? 'whiteMs' : 'blackMs';
      const spent = g.moves.length >= 2 ? now - g.lastMoveAt : 0; // first move each is free
      out[key] = Math.max(0, g[key] - spent) + (g.tc.inc || 0) * 1000;
      if (g[key] - spent <= 0) { out[key] = 0; out.status = 'over'; out.result = mv.color === 'w' ? '0-1' : '1-0'; out.reason = 'timeout'; return out; }
    }
    const res = c.result();
    if (res) { out.status = 'over'; out.result = res.result; out.reason = res.reason; }
    return out;
  }

  /* =============================== LOCAL =============================== */
  class LocalBackend {
    constructor() {
      this.mode = 'local';
      this.chan = 'BroadcastChannel' in root ? new BroadcastChannel('ironforge') : null;
      this.subs = new Set();
      const ping = () => { this.subs.forEach((fn) => fn()); this._emit(); };
      if (this.chan) this.chan.onmessage = ping;
      root.addEventListener('storage', ping);
      this.authCbs = [];
    }
    _get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
    _set(k, v) { localStorage.setItem(k, JSON.stringify(v)); if (this.chan) this.chan.postMessage(k); this.subs.forEach((fn) => fn()); }
    _users() {
      // one key per player so two tabs never overwrite each other's profile
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('if_user_')) { try { const u = JSON.parse(localStorage.getItem(k)); out[u.uid] = u; } catch (e) { } }
      }
      return out;
    }
    _setUser(u) { this._set('if_user_' + u.uid, u); }
    async _hash(s) {
      if (root.crypto && crypto.subtle) {
        const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ironforge:' + s));
        return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
      }
      return btoa(s);
    }
    async init() { }
    _session() {
      // per-tab session (so two tabs can be two different players), seeded from the last sign-in
      let s = sessionStorage.getItem('if_session');
      if (s === null) { s = localStorage.getItem('if_session') || ''; sessionStorage.setItem('if_session', s); }
      return s || null;
    }
    _setSession(uid) { sessionStorage.setItem('if_session', uid || ''); if (uid) localStorage.setItem('if_session', uid); else localStorage.removeItem('if_session'); }
    _emit() {
      const uid = this._session();
      const p = uid ? this._users()[uid] || null : null;
      this.authCbs.forEach((cb) => cb(uid ? { uid, isAnonymous: uid.startsWith('guest_') } : null, p));
    }
    onAuth(cb) { this.authCbs.push(cb); setTimeout(() => this._emit(), 0); }
    providerAvailable(p) { return p === 'email' || p === 'guest'; }
    async signInProvider() { throw new Error('Google, GitHub and Microsoft sign-in need Firebase. See README.md → "Turn on real accounts".'); }
    async signUpEmail(email, pw) {
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email.');
      if ((pw || '').length < 6) throw new Error('Password must be at least 6 characters.');
      const creds = this._get('if_creds', {});
      if (creds[email.toLowerCase()]) throw new Error('That email already has an account. Sign in instead.');
      const uid = 'u_' + uid8();
      creds[email.toLowerCase()] = { uid, hash: await this._hash(pw) };
      this._set('if_creds', creds);
      this._setSession(uid);
      this._emit();
    }
    async signInEmail(email, pw) {
      const c = this._get('if_creds', {})[(email || '').toLowerCase()];
      if (!c || c.hash !== (await this._hash(pw))) throw new Error('Wrong email or password.');
      this._setSession(c.uid);
      this._emit();
    }
    async signInGuest() { this._setSession('guest_' + uid8()); this._emit(); }
    async resetPassword() { throw new Error('Password reset needs Firebase (local mode stores passwords only in this browser).'); }
    async signOut() { this._setSession(null); this._emit(); }
    async claimUsername(user, username) {
      if (!NAME_RE.test(username)) throw new Error('Usernames are 3–20 letters, numbers or underscores.');
      const users = this._users();
      if (Object.values(users).some((u) => u.usernameLower === username.toLowerCase())) throw new Error('That username is taken.');
      const p = newProfile(user.uid, username, user.isAnonymous ? 'guest' : 'email');
      this._setUser(p);
      this._emit();
      return p;
    }
    async getProfile(uid) { return this._users()[uid] || null; }
    async getProfileByName(name) { return Object.values(this._users()).find((u) => u.usernameLower === String(name).toLowerCase()) || null; }
    async updateProfile(uid, fields) {
      const users = this._users();
      if (!users[uid]) throw new Error('No profile.');
      ['locked', 'lockReason', 'username', 'usernameLower', 'uid', 'createdAt'].forEach((k) => delete fields[k]);
      this._setUser(Object.assign(users[uid], fields));
      this._emit();
    }
    async listUsers() { return Object.values(this._users()).sort((a, b) => a.createdAt - b.createdAt); }
    async setLocked(adminUid, uid, locked, reason) {
      const users = this._users();
      if (!users[adminUid] || users[adminUid].usernameLower !== ADMIN) throw new Error('Only the moderator can do that.');
      if (!users[uid]) throw new Error('User not found.');
      users[uid].locked = locked; users[uid].lockReason = locked ? (reason || 'Locked by moderator') : '';
      users[uid].lockedAt = locked ? Date.now() : null;
      this._setUser(users[uid]);
      this._emit();
    }
    /* games */
    _games() { return this._get('if_games', {}); }
    _saveGame(id, g) { const all = this._games(); all[id] = g; this._set('if_games', all); }
    async createGame(uid, profile, color, tc) { const id = uid8(); const g = newGame(uid, profile, color, tc); g.id = id; this._saveGame(id, g); return id; }
    watchOpenGames(cb) {
      const fire = () => cb(Object.entries(this._games()).map(([id, g]) => Object.assign({ id }, g)).filter((g) => g.status === 'open').sort((a, b) => b.createdAt - a.createdAt));
      this.subs.add(fire); fire(); return () => this.subs.delete(fire);
    }
    watchMyGames(uid, cb) {
      const fire = () => cb(Object.entries(this._games()).map(([id, g]) => Object.assign({ id }, g)).filter((g) => g.players.includes(uid)).sort((a, b) => b.updatedAt - a.updatedAt));
      this.subs.add(fire); fire(); return () => this.subs.delete(fire);
    }
    watchGame(id, cb) {
      const fire = () => { const g = this._games()[id]; cb(g ? Object.assign({ id }, g) : null); };
      this.subs.add(fire); fire(); return () => this.subs.delete(fire);
    }
    async _mutate(id, fn) { const g = this._games()[id]; if (!g) throw new Error('Game not found.'); const patch = fn(g); Object.assign(g, patch); this._saveGame(id, g); }
    async joinGame(id, uid, profile) {
      return this._mutate(id, (g) => {
        if (g.status !== 'open') throw new Error('Game already started.');
        if (g.players.includes(uid)) throw new Error('You created this challenge — share the link with an opponent.');
        const now = Date.now();
        return g.white ? { black: uid, blackName: profile.username, players: g.players.concat(uid), status: 'active', updatedAt: now, lastMoveAt: now }
          : { white: uid, whiteName: profile.username, players: g.players.concat(uid), status: 'active', updatedAt: now, lastMoveAt: now };
      });
    }
    async move(id, uid, uci) { return this._mutate(id, (g) => applyMove(g, uid, uci)); }
    async patchGame(id, uid, fnPatch) { return this._mutate(id, (g) => { if (!g.players.includes(uid)) throw new Error('Not your game.'); return fnPatch(g); }); }
    async cancelGame(id) { const all = this._games(); delete all[id]; this._set('if_games', all); }
  }

  /* ============================== FIREBASE ============================= */
  const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  class FirebaseBackend {
    constructor(cfg) { this.mode = 'firebase'; this.cfg = cfg; this.authCbs = []; this.profileUnsub = null; }
    async init() {
      const [appM, authM, fsM] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
      this.A = authM; this.F = fsM;
      this.app = appM.initializeApp(this.cfg);
      this.auth = authM.getAuth(this.app);
      this.db = fsM.getFirestore(this.app);
      authM.onAuthStateChanged(this.auth, (user) => {
        if (this.profileUnsub) { this.profileUnsub(); this.profileUnsub = null; }
        if (!user) { this.authCbs.forEach((cb) => cb(null, null)); return; }
        // live profile so a lock applies instantly
        this.profileUnsub = fsM.onSnapshot(fsM.doc(this.db, 'users', user.uid), (snap) => {
          this.authCbs.forEach((cb) => cb(user, snap.exists() ? snap.data() : null));
        }, () => this.authCbs.forEach((cb) => cb(user, null)));
      });
    }
    onAuth(cb) { this.authCbs.push(cb); }
    providerAvailable() { return true; }
    async signInProvider(name) {
      const A = this.A;
      const p = name === 'google' ? new A.GoogleAuthProvider() : name === 'github' ? new A.GithubAuthProvider() : new A.OAuthProvider('microsoft.com');
      try { await A.signInWithPopup(this.auth, p); }
      catch (e) {
        if (e.code === 'auth/popup-blocked') return A.signInWithRedirect(this.auth, p);
        if (e.code === 'auth/operation-not-allowed') throw new Error(name + ' sign-in is not enabled yet in the Firebase console.');
        if (e.code === 'auth/account-exists-with-different-credential') throw new Error('That email already uses a different sign-in method. Use that one.');
        throw e;
      }
    }
    async signUpEmail(email, pw) { await this.A.createUserWithEmailAndPassword(this.auth, email, pw); }
    async signInEmail(email, pw) { await this.A.signInWithEmailAndPassword(this.auth, email, pw); }
    async signInGuest() { await this.A.signInAnonymously(this.auth); }
    async resetPassword(email) { await this.A.sendPasswordResetEmail(this.auth, email); }
    async signOut() { await this.A.signOut(this.auth); }
    async claimUsername(user, username) {
      if (!NAME_RE.test(username)) throw new Error('Usernames are 3–20 letters, numbers or underscores.');
      const F = this.F, lower = username.toLowerCase();
      const provider = user.isAnonymous ? 'guest' : ((user.providerData[0] || {}).providerId || 'email').replace('.com', '');
      const p = newProfile(user.uid, username, provider);
      try {
        await F.runTransaction(this.db, async (tx) => {
          const nameRef = F.doc(this.db, 'usernames', lower);
          if ((await tx.get(nameRef)).exists()) throw new Error('That username is taken.');
          tx.set(nameRef, { uid: user.uid });
          tx.set(F.doc(this.db, 'users', user.uid), p);
        });
      } catch (e) {
        if (e.code === 'permission-denied') throw new Error(lower === ADMIN ? 'That username is reserved for the site owner.' : 'Could not claim that username.');
        throw e;
      }
      return p;
    }
    async getProfile(uid) { const s = await this.F.getDoc(this.F.doc(this.db, 'users', uid)); return s.exists() ? s.data() : null; }
    async getProfileByName(name) {
      const s = await this.F.getDoc(this.F.doc(this.db, 'usernames', String(name).toLowerCase()));
      return s.exists() ? this.getProfile(s.data().uid) : null;
    }
    async updateProfile(uid, fields) {
      ['locked', 'lockReason', 'username', 'usernameLower', 'uid', 'createdAt'].forEach((k) => delete fields[k]);
      await this.F.updateDoc(this.F.doc(this.db, 'users', uid), fields);
    }
    async listUsers() {
      const s = await this.F.getDocs(this.F.query(this.F.collection(this.db, 'users'), this.F.limit(1000)));
      return s.docs.map((d) => d.data()).sort((a, b) => a.createdAt - b.createdAt);
    }
    async setLocked(adminUid, uid, locked, reason) {
      await this.F.updateDoc(this.F.doc(this.db, 'users', uid), { locked, lockReason: locked ? (reason || 'Locked by moderator') : '', lockedAt: locked ? Date.now() : null });
    }
    async createGame(uid, profile, color, tc) {
      const ref = await this.F.addDoc(this.F.collection(this.db, 'games'), newGame(uid, profile, color, tc));
      return ref.id;
    }
    _watchQuery(q, cb) { return this.F.onSnapshot(q, (s) => cb(s.docs.map((d) => Object.assign({ id: d.id }, d.data()))), (e) => { console.warn(e); cb([]); }); }
    watchOpenGames(cb) {
      const F = this.F;
      return this._watchQuery(F.query(F.collection(this.db, 'games'), F.where('status', '==', 'open'), F.limit(50)), (list) => cb(list.sort((a, b) => b.createdAt - a.createdAt)));
    }
    watchMyGames(uid, cb) {
      const F = this.F;
      return this._watchQuery(F.query(F.collection(this.db, 'games'), F.where('players', 'array-contains', uid), F.limit(100)), (list) => cb(list.sort((a, b) => b.updatedAt - a.updatedAt)));
    }
    watchGame(id, cb) { return this.F.onSnapshot(this.F.doc(this.db, 'games', id), (s) => cb(s.exists() ? Object.assign({ id: s.id }, s.data()) : null), () => cb(null)); }
    async _mutate(id, fn) {
      const F = this.F, ref = F.doc(this.db, 'games', id);
      await F.runTransaction(this.db, async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists()) throw new Error('Game not found.');
        tx.update(ref, fn(s.data()));
      });
    }
    async joinGame(id, uid, profile) {
      return this._mutate(id, (g) => {
        if (g.status !== 'open') throw new Error('Game already started.');
        if (g.players.includes(uid)) throw new Error('You created this challenge — share the link with an opponent.');
        const now = Date.now();
        return g.white ? { black: uid, blackName: profile.username, players: g.players.concat(uid), status: 'active', updatedAt: now, lastMoveAt: now }
          : { white: uid, whiteName: profile.username, players: g.players.concat(uid), status: 'active', updatedAt: now, lastMoveAt: now };
      });
    }
    async move(id, uid, uci) { return this._mutate(id, (g) => applyMove(g, uid, uci)); }
    async patchGame(id, uid, fnPatch) { return this._mutate(id, (g) => { if (!g.players.includes(uid)) throw new Error('Not your game.'); return fnPatch(g); }); }
    async cancelGame(id) { await this.F.deleteDoc(this.F.doc(this.db, 'games', id)); }
  }

  root.Backend = {
    async create() {
      if (CFG.firebase && CFG.firebase.apiKey) {
        const fb = new FirebaseBackend(CFG.firebase);
        try { await fb.init(); return fb; } catch (e) { console.error('Firebase failed to start, using local mode', e); root.__fbError = e.message; }
      }
      const lb = new LocalBackend(); await lb.init(); return lb;
    },
    isAdmin(profile) { return !!profile && profile.usernameLower === ADMIN && !profile.locked; },
    ADMIN,
  };
})(window);
