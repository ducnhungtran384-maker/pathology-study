'use strict';
(() => {
  const AUTH_KEY = 'pathology-cloud-account-v1';
  const BACKUP_KEY = 'pathology-cloud-backups-v1';
  const CODE_RE = /^BL-[A-Za-z0-9_-]{32}$/;
  const copy = value => JSON.parse(JSON.stringify(value));
  const stable = value => JSON.stringify(sort(value));
  function sort(value) {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
    return value;
  }
  function actual(state) {
    return !!(Object.values(state?.records || {}).some(r => Number(r?.attempts) > 0) || state?.bookmarks?.length || Object.keys(state?.session?.answers || {}).length);
  }
  function failure(message, kind = 'error') { const error = new Error(message); error.kind = kind; return error; }
  function create(options) {
    const config = window.PATHOLOGY_CLOUD || {};
    const url = String(config.url || '').replace(/\/+$/, ''), key = String(config.key || '');
    const configured = /^https:\/\//.test(url) && !!key;
    const getState = options.getState, applyState = options.applyState;
    let account = null, meta = { revision: 0, acknowledged: null, pending: null, lastSyncedAt: null };
    let status = 'disabled', conflict = null, initialized = false, applying = false, destroyed = false;
    let debounce = null, interval = null, generation = 0, queue = Promise.resolve(), refreshPromise = null;
    const listeners = [];
    function info() { return { connected: !!account, code: account?.code || '', status, revision: meta.revision, pending: !!meta.pending, lastSyncedAt: meta.lastSyncedAt, conflict: !!conflict }; }
    function emit(state, message) {
      status = state;
      options.onStatus?.({ ...info(), state, message });
    }
    function accountChanged(restored = false) { options.onAccount?.({ connected: !!account, code: account?.code || '', restored }); }
    function readLocal(name, fallback) { try { return JSON.parse(localStorage.getItem(name) || 'null') || fallback; } catch (_) { return fallback; } }
    function putLocal(name, data) {
      try { localStorage.setItem(name, JSON.stringify(data)); }
      catch (_) { throw failure('浏览器无法保存同步资料，请先导出本机进度，并允许网站使用本机存储。', 'storage'); }
    }
    function metaKey() { return 'pathology-cloud-state-v1:' + account.user.id; }
    function persist() { if (account) putLocal(metaKey(), meta); }
    function persistAccount() { if (account) putLocal(AUTH_KEY, account); }
    function backup(reason, state = getState()) {
      const list = readLocal(BACKUP_KEY, []);
      const entries = Array.isArray(list) ? list : [];
      entries.unshift({ at: new Date().toISOString(), reason, account: account?.user?.id || null, state: copy(state) });
      putLocal(BACKUP_KEY, entries.slice(0, 5));
    }
    function loadMeta() {
      const saved = readLocal(metaKey(), {});
      meta = { revision: Number.isSafeInteger(saved.revision) && saved.revision >= 0 ? saved.revision : 0,
        acknowledged: saved.acknowledged && typeof saved.acknowledged === 'object' ? saved.acknowledged : null,
        pending: saved.pending && typeof saved.pending === 'object' ? saved.pending : null,
        lastSyncedAt: saved.lastSyncedAt || null };
    }
    function checkGeneration(version) { if (generation !== version || !account || destroyed) throw failure('同步操作已取消。', 'cancelled'); }
    function online() { return navigator.onLine !== false; }
    function showError(error) {
      if (error.kind === 'cancelled') return;
      if (!online() || error.kind === 'network') emit('offline', '暂时离线，进度已保留在本机；联网后自动重试。');
      else emit('error', error.message || '同步暂未完成，本机进度已保留，请稍后重试。');
    }
    async function request(path, body, token, retry = true) {
      if (!online()) throw failure('当前网络不可用。', 'network');
      const requestGeneration = generation;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
      let response, data;
      try {
        response = await fetch(url + path, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body), signal: controller.signal });
        try { data = await response.json(); }
        catch (_) {
          if (controller.signal.aborted) throw failure('网络连接超时。', 'network');
          data = {};
        }
      } catch (_) { throw failure('网络连接失败。', 'network'); }
      finally { clearTimeout(timer); }
      if (response.ok) return data;
      if (response.status === 401 && token && retry && account) {
        checkGeneration(requestGeneration);
        await refresh();
        checkGeneration(requestGeneration);
        return request(path, body, account.access_token, false);
      }
      if (String(data.message || '').includes('revision_conflict')) throw failure('另一台设备有新进度，请选择要保留的版本。', 'conflict');
      if (response.status === 429) throw failure('连接次数较多，请稍等片刻再试。');
      if (path.includes('/auth/') && response.status < 500) {
        if (data.error_code === 'email_not_confirmed') throw failure('云端账号尚未启用，请检查网站的登录配置。');
        if (path.includes('refresh_token')) throw failure('登录已失效，请使用原同步码重新连接。', 'auth');
        throw failure('连接失败，请确认同步码完整正确；请勿输入他人的同步码。', 'auth');
      }
      if (response.status >= 500) throw failure('云端暂时不可用，本机进度已保留，请稍后重试。');
      throw failure('云同步未完成，请检查服务配置后重试；本机进度已保留。');
    }
    function installTokens(data, code) {
      if (!data?.access_token || !data?.refresh_token || !data?.user?.id) throw failure('云端未返回可用登录状态，请检查账号确认设置。');
      account = { code, access_token: data.access_token, refresh_token: data.refresh_token, user: { id: data.user.id }, expires_at: Number(data.expires_at) || Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 3600) };
      persistAccount();
    }
    async function refresh() {
      if (refreshPromise) return refreshPromise;
      const version = generation, saved = account;
      if (!saved) throw failure('请先连接同步码。', 'auth');
      refreshPromise = (async () => {
        const data = await request('/auth/v1/token?grant_type=refresh_token', { refresh_token: saved.refresh_token }, null, false);
        checkGeneration(version);
        installTokens(data, saved.code);
      })();
      try { await refreshPromise; } finally { refreshPromise = null; }
    }
    async function rpc(name, body = {}) {
      const version = generation;
      if (account.expires_at * 1000 - Date.now() < 60000) await refresh();
      checkGeneration(version);
      let result = await request('/rest/v1/rpc/' + name, body, account.access_token);
      checkGeneration(version);
      if (Array.isArray(result) && result.length === 1) result = result[0];
      if (!result || !Number.isSafeInteger(Number(result.revision)) || Number(result.revision) < 0 || (result.state !== null && typeof result.state !== 'object')) throw failure('云端进度格式异常，本机进度没有被覆盖。');
      return { revision: Number(result.revision), state: result.state };
    }
    function apply(remote) {
      applying = true;
      try { applyState(copy(remote)); }
      finally { applying = false; }
    }
    function acknowledged(remote, shouldApply) {
      meta.revision = remote.revision;
      meta.acknowledged = copy(remote.state);
      meta.lastSyncedAt = new Date().toISOString();
      if (shouldApply && remote.state) apply(remote.state);
      persist();
    }
    function markConflict(remote) {
      if (!conflict) backup('云端与本机进度不同', meta.pending || getState());
      conflict = remote;
      persist();
      emit('conflict', '本机和云端都有不同进度。已保留本机备份，请选择要继续使用的版本。');
    }
    async function writePending(remote) {
      if (!meta.pending) return;
      const sending = copy(meta.pending), fingerprint = stable(sending);
      let result;
      try { result = await rpc('write_progress', { expected_revision: remote.revision, new_state: sending }); }
      catch (error) {
        if (error.kind !== 'conflict') throw error;
        markConflict(await rpc('read_progress'));
        return;
      }
      if (!result.state || stable(result.state) !== fingerprint) throw failure('云端保存结果未能核对，本机进度已保留，请重试。');
      if (meta.pending && stable(meta.pending) === fingerprint) meta.pending = null;
      acknowledged(result, false);
      if (meta.pending) emit('syncing', '正在上传刚更新的进度…');
      else emit('synced', '进度已同步，其他设备使用同一同步码即可继续。');
    }
    async function perform(first = false) {
      if (!account || destroyed) return info();
      if (conflict) { emit('conflict', '本机和云端进度不同，请先选择要继续使用的版本。'); return info(); }
      if (!online()) { emit('offline', '暂时离线，进度已保留在本机；联网后自动重试。'); return info(); }
      emit('syncing', '正在核对云端进度…');
      const remote = await rpc('read_progress');
      const current = copy(getState());
      if (!remote.state) {
        meta.revision = remote.revision;
        if (!meta.pending) meta.pending = current;
        persist();
        await writePending(remote);
      } else if (first) {
        const local = meta.pending || current;
        if (stable(local) === stable(remote.state)) {
          meta.pending = null;
          acknowledged(remote, false);
          emit('synced', '进度已同步。');
        } else if (meta.pending && meta.acknowledged && remote.revision === meta.revision) {
          await writePending(remote);
        } else if (!meta.pending && meta.acknowledged && stable(local) === stable(meta.acknowledged)) {
          acknowledged(remote, true);
          emit('synced', '已加载云端的最新进度，可以继续答题。');
        } else if (actual(local) || (meta.pending && meta.acknowledged)) {
          markConflict(remote);
        } else {
          meta.pending = null;
          acknowledged(remote, true);
          emit('synced', '已加载云端进度，可以继续答题。');
        }
      } else if (meta.pending) {
        if (stable(meta.pending) === stable(remote.state)) {
          meta.pending = null;
          acknowledged(remote, false);
          emit('synced', '进度已同步。');
        } else if (remote.revision !== meta.revision) markConflict(remote);
        else await writePending(remote);
      } else {
        const changed = stable(current) !== stable(remote.state);
        acknowledged(remote, changed);
        emit('synced', changed ? '已更新为其他设备的最新进度。' : '进度已同步。');
      }
      return info();
    }
    function enqueue(operation) {
      const version = generation;
      const result = queue.catch(() => {}).then(async () => {
        if (destroyed || version !== generation) return info();
        try { return await operation(); }
        catch (error) { showError(error); throw error; }
      });
      queue = result.catch(() => {});
      return result;
    }
    function background() { if (account && !destroyed) sync().catch(() => {}); }
    function startEvents() {
      if (interval) return;
      interval = setInterval(() => { if (document.visibilityState !== 'hidden') background(); }, 15000);
      for (const [target, name, fn] of [[window, 'online', background], [window, 'focus', background], [window, 'offline', () => { if (account) emit('offline', '暂时离线，进度保留在本机，联网后自动同步。'); }], [document, 'visibilitychange', () => { if (document.visibilityState === 'visible' || meta.pending) background(); }]]) {
        target.addEventListener(name, fn); listeners.push([target, name, fn]);
      }
    }
    async function init() {
      if (initialized) return info();
      initialized = true;
      if (!configured) { emit('disabled', '云同步尚未配置，当前进度保存在本机。'); return info(); }
      startEvents();
      const saved = readLocal(AUTH_KEY, null);
      if (!saved?.user?.id || !CODE_RE.test(saved.code || '') || !saved.access_token || !saved.refresh_token) {
        accountChanged(); emit('disabled', '创建或输入同步码，让其他设备继续同一份进度。'); return info();
      }
      account = saved; loadMeta(); accountChanged(true);
      const current = copy(getState());
      if (meta.pending || (meta.acknowledged && actual(current) && stable(current) !== stable(meta.acknowledged))) {
        meta.pending = current; persist();
      }
      return enqueue(() => perform(true));
    }
    async function connect(input) {
      if (!configured) throw failure('云同步尚未配置。');
      if (!initialized) { initialized = true; startEvents(); }
      const generated = !input;
      let code = String(input || '').trim();
      if (generated) {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        code = 'BL-' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }
      if (!CODE_RE.test(code)) throw failure('同步码格式不完整，请复制完整的 BL- 开头同步码。');
      const version = ++generation;
      clearTimeout(debounce);
      return enqueue(async () => {
        emit('syncing', generated ? '正在创建私人同步空间…' : '正在连接同步空间…');
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
        const email = 'p-' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('').slice(0, 32) + '@pathology-sync.invalid';
        const data = await request(generated ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password', { email, password: code }, null, false);
        if (version !== generation || destroyed) throw failure('同步操作已取消。', 'cancelled');
        installTokens(data, code); loadMeta(); conflict = null; accountChanged();
        return perform(true);
      });
    }
    function disconnect() {
      generation++; clearTimeout(debounce); conflict = null; account = null;
      try { localStorage.removeItem(AUTH_KEY); } catch (_) {}
      meta = { revision: 0, acknowledged: null, pending: null, lastSyncedAt: null };
      accountChanged(); emit('disabled', '已退出云同步，本机学习进度仍然保留。');
      return info();
    }
    function noteChange() {
      if (!account || applying || destroyed) return;
      try {
        meta.pending = copy(getState()); persist();
        if (conflict) { emit('conflict', '本机进度已保存，请先处理与云端的不同版本。'); return; }
        if (!online()) { emit('offline', '暂时离线，进度已保留在本机；联网后自动重试。'); return; }
        emit('syncing', '进度已保存在本机，准备同步…');
        clearTimeout(debounce); debounce = setTimeout(background, 300);
      } catch (error) { showError(error); }
    }
    function sync() { return enqueue(() => perform(false)); }
    function resolve(choice) {
      if (!['cloud', 'local'].includes(choice)) return Promise.reject(failure('请选择本机或云端进度。'));
      return enqueue(async () => {
        if (!account || !conflict) return info();
        emit('syncing', '正在重新核对最新云端进度…');
        const localAtChoice = stable(getState());
        const remote = await rpc('read_progress');
        if (choice === 'cloud' && stable(getState()) !== localAtChoice) {
          markConflict(remote);
          return info();
        }
        backup(choice === 'cloud' ? '选择云端前的本机备份' : '选择本机前的云端备份', choice === 'cloud' ? getState() : (remote.state || getState()));
        if (choice === 'cloud') {
          if (!remote.state) throw failure('云端目前没有进度，本机进度已保留。');
          meta.pending = null; conflict = null; acknowledged(remote, true);
          emit('synced', '已采用云端进度，本机原进度已留备份。');
        } else {
          meta.pending = copy(getState()); meta.revision = remote.revision; persist(); conflict = null;
          await writePending(remote);
        }
        return info();
      });
    }
    function destroy() {
      destroyed = true; generation++; clearInterval(interval); clearTimeout(debounce);
      for (const [target, name, fn] of listeners) target.removeEventListener(name, fn);
    }
    function getBackups() {
      const stored = readLocal(BACKUP_KEY, []);
      return account && Array.isArray(stored) ? copy(stored.filter(item => item.account === account.user.id).map(({ at, reason, state }) => ({ at, reason, state }))) : [];
    }
    return { init, connect, disconnect, noteChange, sync, resolve, getInfo: info, getBackups, destroy };
  }
  window.PathologyCloud = Object.freeze({ create });
})();
