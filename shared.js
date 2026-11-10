(function () {
  const cfg = window.APP_CONFIG;
  // Several teachers can share one site: ?t=name picks that teacher's backend.
  cfg.TEACHER_KEY = new URLSearchParams(location.search).get('t') || cfg.DEFAULT_TEACHER || '';
  if (cfg.TEACHERS) cfg.API_URL = cfg.TEACHERS[cfg.TEACHER_KEY];
  window.Auth = { token: null, profile: null };
  let pendingAuth = null;

  function decode(t) {
    const p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(atob(p).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
  }
  function whenGoogle(cb) {
    if (window.google && google.accounts && google.accounts.id) cb(); else setTimeout(() => whenGoogle(cb), 100);
  }

  window.startSignIn = function (btnEl, onSignedIn) {
    whenGoogle(() => {
      google.accounts.id.initialize({
        client_id: cfg.GOOGLE_CLIENT_ID,
        auto_select: true,
        callback: resp => {
          Auth.token = resp.credential;
          Auth.profile = decode(resp.credential);
          if (pendingAuth) { const p = pendingAuth; pendingAuth = null; hideReauth(); p(); }
          else onSignedIn(Auth.profile);
        }
      });
      google.accounts.id.renderButton(btnEl, { theme: 'outline', size: 'large', text: 'signin_with' });
      google.accounts.id.prompt();
    });
  };

  function askReauth() {
    return new Promise(res => {
      pendingAuth = res;
      let m = document.getElementById('reauth');
      if (!m) {
        m = document.createElement('div');
        m.id = 'reauth'; m.className = 'modal';
        m.innerHTML = '<div class="card"><h3>Sign in again</h3><p>Google sign-ins last about an hour. Your work is saved.</p><div id="reauthBtn" style="display:flex;justify-content:center"></div></div>';
        document.body.appendChild(m);
      }
      m.style.display = 'flex';
      google.accounts.id.renderButton(document.getElementById('reauthBtn'), { theme: 'filled_blue', size: 'large' });
      google.accounts.id.prompt();
    });
  }
  function hideReauth() { const m = document.getElementById('reauth'); if (m) m.style.display = 'none'; }

  window.api = async function (action, payload) {
    if (!cfg.API_URL || /^PASTE/.test(cfg.API_URL)) throw new Error('This link does not match a known teacher. Check the link you were given.');
    for (let attempt = 0; attempt < 2; attempt++) {
      let data;
      try {
        const res = await fetch(cfg.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // plain text avoids a CORS preflight
          body: JSON.stringify(Object.assign({ action: action, token: Auth.token }, payload || {}))
        });
        data = await res.json();
      } catch (e) { throw new Error('Could not reach the server. Check your connection and try again.'); }
      if (data.ok) return data;
      if (data.code === 'AUTH' && attempt === 0) { await askReauth(); continue; }
      const err = new Error(data.error || 'Something went wrong.'); err.code = data.code; throw err;
    }
  };

  window.$ = id => document.getElementById(id);
  window.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.escBr = s => esc(s).replace(/\n/g, '<br>');
  window.fmt = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  window.parseTime = str => { const p = String(str).trim().split(':').map(Number); if (p.some(isNaN)) return NaN; return p.reduce((a, n) => a * 60 + n, 0); };
  window.ytId = u => { const m = String(u).match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/); return m ? m[1] : (/^[\w-]{11}$/.test(u.trim()) ? u.trim() : ''); };
  window.uid = () => 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  window.loadYT = function () {
    return new Promise(res => {
      if (window.YT && YT.Player) return res();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
      if (!document.getElementById('yt-api')) { const s = document.createElement('script'); s.id = 'yt-api'; s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s); }
    });
  };
})();
