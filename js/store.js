/* =============================================================================
   store.js — 입력 상태 · 임시저장 · 비교함

   기획서 2-4: "입력값은 새로고침해도 유지되도록 임시 저장"
   기획서 2-5: 2·3번째 홀 입력 시 공통값 자동 채우기
   localStorage 를 못 쓰는 환경(시크릿 모드 등)에서도 메모리로만 정상 동작합니다.
   ========================================================================== */

var Store = (function () {

  var state = {};
  var compare = [];
  var step = 1;
  var isExample = true;      /* 예시값 그대로인지 (한 글자라도 고치면 false) */
  var carriedKeys = {};      /* 이전 홀에서 이어받은 필드 (사용자가 고치면 해제) */
  var listeners = [];

  /* ── localStorage 안전 래퍼 ────────────────────────────────────────────── */
  var LS = (function () {
    var ok = false;
    try {
      var k = '__sding_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      ok = true;
    } catch (e) { ok = false; }
    return {
      available: ok,
      get: function (key) {
        if (!ok) return null;
        try { return window.localStorage.getItem(key); } catch (e) { return null; }
      },
      set: function (key, val) {
        if (!ok) return;
        try { window.localStorage.setItem(key, val); } catch (e) { /* 용량 초과 무시 */ }
      },
      del: function (key) {
        if (!ok) return;
        try { window.localStorage.removeItem(key); } catch (e) { /* noop */ }
      }
    };
  })();

  /* ── 기본값 ───────────────────────────────────────────────────────────── */
  function blank() {
    var s = {};
    for (var key in CONFIG.fields) {
      if (!Object.prototype.hasOwnProperty.call(CONFIG.fields, key)) continue;
      var f = CONFIG.fields[key];
      s[key] = f.type === 'enum' ? f.def : '';
    }
    return s;
  }

  function example() {
    var s = blank();
    for (var key in CONFIG.example) {
      if (Object.prototype.hasOwnProperty.call(CONFIG.example, key)) s[key] = CONFIG.example[key];
    }
    return s;
  }

  /* enum 값이 오염되지 않았는지 검사 */
  function sanitize(raw) {
    var s = blank();
    if (!raw || typeof raw !== 'object') return s;
    for (var key in CONFIG.fields) {
      if (!Object.prototype.hasOwnProperty.call(CONFIG.fields, key)) continue;
      var f = CONFIG.fields[key];
      var v = raw[key];
      if (v === undefined || v === null) continue;
      if (f.type === 'number') {
        s[key] = (v === '' ? '' : Fmt.int(v));
      } else if (f.type === 'text') {
        s[key] = String(v).slice(0, 60);
      } else {
        s[key] = String(v);
      }
    }
    /* enum 화이트리스트 */
    if (s.guaranteeMode !== 'separate') s.guaranteeMode = 'unified';
    if (s.mealVatMode !== 'included') s.mealVatMode = 'excluded';
    if (s.otherVatMode !== 'excluded') s.otherVatMode = 'included';
    if (s.optionMode !== 'detail') s.optionMode = 'total';
    return s;
  }

  /* ── 저장 / 복원 ──────────────────────────────────────────────────────── */
  function persist() {
    LS.set(CONFIG.storage.draft, JSON.stringify({ s: state, ex: isExample }));
    LS.set(CONFIG.storage.step, String(step));
  }

  function persistCompare() {
    LS.set(CONFIG.storage.compare, JSON.stringify(compare));
  }

  function restore() {
    var rawDraft = LS.get(CONFIG.storage.draft);
    if (rawDraft) {
      try {
        var parsed = JSON.parse(rawDraft);
        state = sanitize(parsed && parsed.s);
        isExample = !!(parsed && parsed.ex);
      } catch (e) {
        state = example();
        isExample = true;
      }
    } else {
      state = example();
      isExample = true;
    }

    var rawStep = LS.get(CONFIG.storage.step);
    var n = parseInt(rawStep, 10);
    step = (n >= 1 && n <= 5) ? n : 1;

    var rawCmp = LS.get(CONFIG.storage.compare);
    compare = [];
    if (rawCmp) {
      try {
        var arr = JSON.parse(rawCmp);
        if (Object.prototype.toString.call(arr) === '[object Array]') {
          for (var i = 0; i < arr.length && compare.length < CONFIG.MAX_COMPARE; i++) {
            var it = arr[i];
            if (!it || typeof it !== 'object') continue;
            compare.push({
              id: String(it.id || ('h' + i)),
              name: String(it.name || '이름 없는 홀').slice(0, 40),
              state: sanitize(it.state)
            });
          }
        }
      } catch (e) { compare = []; }
    }
  }

  /* ── 구독 ─────────────────────────────────────────────────────────────── */
  function subscribe(fn) { listeners.push(fn); }
  function emit(reason) {
    for (var i = 0; i < listeners.length; i++) listeners[i](reason);
  }

  /* ── 상태 접근 ────────────────────────────────────────────────────────── */
  function get(key) { return state[key]; }
  function all() { return state; }

  function set(key, value, opts) {
    if (!Object.prototype.hasOwnProperty.call(CONFIG.fields, key)) return;
    state[key] = value;
    if (!(opts && opts.silent)) {
      isExample = false;
      if (carriedKeys[key]) delete carriedKeys[key];   /* 사용자가 손댔으면 더 이상 물려받은 값이 아니다 */
      persist();
      emit('field');
    }
  }

  function isCarried(key) { return !!carriedKeys[key]; }
  function carriedCount() {
    var n = 0;
    for (var k in carriedKeys) if (Object.prototype.hasOwnProperty.call(carriedKeys, k)) n++;
    return n;
  }
  function clearCarried() { carriedKeys = {}; emit('field'); }

  function isExampleData() { return isExample; }

  function clearAll() {
    state = blank();
    isExample = false;
    carriedKeys = {};
    persist();
    emit('reset');
  }

  function loadExample() {
    state = example();
    isExample = true;
    carriedKeys = {};
    persist();
    emit('reset');
  }

  /* 다음 홀 입력 — 같은 결혼식이므로 하객/축의금/부가세 방식은 이어받는다.
     이어받은 필드는 carriedKeys 에 남겨 화면이 "이전 홀에서 가져옴"을 표시하게 한다.
     (앱이 채운 값과 사용자가 넣은 값은 구분되어야 한다) */
  function startNextHall() {
    var carried = blank();
    carriedKeys = {};
    for (var i = 0; i < CONFIG.carryOverFields.length; i++) {
      var k = CONFIG.carryOverFields[i];
      carried[k] = state[k];
      var def = CONFIG.fields[k];
      if (def && def.type !== 'enum' && state[k] !== '' && state[k] !== undefined) carriedKeys[k] = true;
    }
    /* 보증인원은 홀마다 다르므로 이어받지 않는다 */
    state = carried;
    isExample = false;
    step = 1;
    persist();
    emit('reset');
  }

  function loadFrom(snapshot) {
    state = sanitize(snapshot);
    isExample = false;
    carriedKeys = {};
    step = 1;
    persist();
    emit('reset');
  }

  /* ── 스텝 ─────────────────────────────────────────────────────────────── */
  function getStep() { return step; }
  function setStep(n) {
    n = Math.min(5, Math.max(1, parseInt(n, 10) || 1));
    if (n === step) return;
    step = n;
    persist();
    emit('step');
  }

  /* ── 비교함 ───────────────────────────────────────────────────────────── */
  function compareList() { return compare; }
  function compareCount() { return compare.length; }
  function compareFull() { return compare.length >= CONFIG.MAX_COMPARE; }

  function compareAdd(name) {
    if (compareFull()) return { ok: false, reason: 'full' };
    var snapshot = {};
    for (var k in state) {
      if (Object.prototype.hasOwnProperty.call(state, k)) snapshot[k] = state[k];
    }
    var id = 'h' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
    compare.push({
      id: id,
      name: (name || '').toString().trim() || ('웨딩홀 ' + (compare.length + 1)),
      state: snapshot
    });
    persistCompare();
    emit('compare');
    return { ok: true, id: id };
  }

  function compareRemove(id) {
    for (var i = 0; i < compare.length; i++) {
      if (compare[i].id === id) { compare.splice(i, 1); break; }
    }
    persistCompare();
    emit('compare');
  }

  function compareClear() {
    compare = [];
    persistCompare();
    emit('compare');
  }

  /* compareClear를 되돌리기 위해 원래 배열을 통째로 복원한다 (id 유지) */
  function compareRestore(list) {
    compare = (list || []).slice(0, CONFIG.MAX_COMPARE);
    persistCompare();
    emit('compare');
  }

  function compareGet(id) {
    for (var i = 0; i < compare.length; i++) if (compare[i].id === id) return compare[i];
    return null;
  }

  /* ── init ─────────────────────────────────────────────────────────────── */
  restore();

  return {
    storageAvailable: LS.available,
    all: all,
    get: get,
    set: set,
    isExampleData: isExampleData,
    isCarried: isCarried,
    carriedCount: carriedCount,
    clearCarried: clearCarried,
    clearAll: clearAll,
    loadExample: loadExample,
    startNextHall: startNextHall,
    loadFrom: loadFrom,
    getStep: getStep,
    setStep: setStep,
    subscribe: subscribe,
    compareList: compareList,
    compareCount: compareCount,
    compareFull: compareFull,
    compareAdd: compareAdd,
    compareRemove: compareRemove,
    compareClear: compareClear,
    compareRestore: compareRestore,
    compareGet: compareGet
  };
})();
