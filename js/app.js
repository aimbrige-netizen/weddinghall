/* =============================================================================
   app.js — 입력 폼 · 결과 · 비교함 연결

   뷰: wizard(한 페이지 연속 입력) / result / compare
   브라우저 뒤로가기는 이전 뷰로 예측 가능하게 동작합니다(history API).
   ========================================================================== */

(function () {
  'use strict';

  /* ── 짧은 헬퍼 ────────────────────────────────────────────────────────── */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── DOM ──────────────────────────────────────────────────────────────── */
  var el = {
    shell:        $('#shell'),
    viewWizard:   $('#viewWizard'),
    viewResult:   $('#viewResult'),
    viewCompare:  $('#viewCompare'),
    resultRoot:   $('#resultRoot'),
    compareRoot:  $('#compareRoot'),
    form:         $('#wizardForm'),
    notice:       $('#exampleNotice'),
    btnClearAll:  $('#btnClearAll'),
    btnNext:      $('#btnNext'),
    dock:         $('#dock'),
    dockLive:     $('#dockLive'),
    dockActions:  $('#dockActions'),
    btnCompare:   $('#btnOpenCompare'),
    badge:        $('#compareBadge'),
    toast:        $('#toast'),
    toastMsg:     $('#toastMsg'),
    toastUndo:    $('#toastUndo')
  };

  var view = 'wizard';
  var toastTimer = null;
  var suppressHistory = false;

  /* ── 토스트 ───────────────────────────────────────────────────────────────
     opts.undo가 있으면 파괴적 액션(전부 비우기 등)을 되돌릴 수 있는 버튼을 띄운다.
     시간이 넉넉해야 실수로 지운 걸 알아챌 수 있어 되돌리기가 있을 때는 더 오래 둔다. */
  function toast(msg, opts) {
    el.toastMsg.textContent = msg;
    el.toast.classList.add('is-on');
    if (toastTimer) clearTimeout(toastTimer);

    el.toastUndo.onclick = null;
    if (opts && opts.undo) {
      el.toastUndo.hidden = false;
      el.toastUndo.onclick = function () {
        clearTimeout(toastTimer);
        el.toast.classList.remove('is-on');
        opts.undo();
      };
    } else {
      el.toastUndo.hidden = true;
    }

    var dur = (opts && opts.undo) ? 5000 : 3200;
    toastTimer = setTimeout(function () { el.toast.classList.remove('is-on'); }, dur);
  }

  /* ── 장부(ledger) 마크업 ──────────────────────────────────────────────── */
  function ledgerRows(rows) {
    var out = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r) continue;
      var cls = 'led-row';
      if (r.type === 'sub') cls += ' is-sub';
      if (r.type === 'minus') cls += ' is-minus';
      if (r.type === 'total') cls += ' is-total';
      if (r.flag) cls += ' is-flag';
      out += '<div class="' + cls + '">'
           +   '<span class="led-k">' + esc(r.label)
           +     (r.memo ? '<span class="memo">' + esc(r.memo) + '</span>' : '')
           +   '</span>'
           +   '<span class="led-v">' + esc(r.value) + '</span>'
           + '</div>';
    }
    return out;
  }

  function ledger(headLabel, headNote, rows, note) {
    return '<div class="led-head"><span>' + esc(headLabel) + '</span>'
         +   (headNote ? '<span class="led-head-note">' + esc(headNote) + '</span>' : '')
         + '</div>'
         + ledgerRows(rows)
         + (note ? '<p class="led-note">' + note + '</p>' : '');
  }

  /* ── 폼 ↔ 상태 ────────────────────────────────────────────────────────── */
  function writeInputs() {
    $$('[data-field]', el.form).forEach(function (input) {
      var key = input.getAttribute('data-field');
      var val = Store.get(key);
      if (input.getAttribute('data-type') === 'number') {
        input.value = (val === '' || val === undefined || val === null) ? '' : Fmt.comma(val);
      } else {
        input.value = val === undefined || val === null ? '' : val;
      }
      /* 이전 홀에서 물려받은 값은 사용자가 넣은 값과 구분해서 보여준다 */
      var wrap = input.closest ? input.closest('.input-wrap') : null;
      if (wrap) wrap.classList.toggle('is-carried', Store.isCarried(key));
    });

    $$('[data-toggle]').forEach(function (group) {
      var key = group.getAttribute('data-toggle');
      var cur = Store.get(key);
      $$('.seg-btn', group).forEach(function (btn) {
        var on = btn.getAttribute('data-value') === cur;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });

    syncConditionals();
    syncHelps();
  }

  function syncConditionals() {
    $$('[data-when]').forEach(function (node) {
      var cond = node.getAttribute('data-when').split('=');
      var match = Store.get(cond[0]) === cond[1];
      if (match) node.removeAttribute('hidden');
      else node.setAttribute('hidden', '');
    });
  }

  function syncHelps() {
    $$('[data-help]').forEach(function (node) {
      var key = node.getAttribute('data-help');
      var map = CONFIG.helps[key];
      node.innerHTML = (map && map[Store.get(key)]) || '';
    });
  }

  /* 입력 — 천단위 콤마를 유지하며 커서 위치 보존 */
  el.form.addEventListener('input', function (e) {
    var input = e.target;
    if (!input || !input.getAttribute || !input.getAttribute('data-field')) return;
    var key = input.getAttribute('data-field');

    if (input.getAttribute('data-type') === 'number') {
      var n = Fmt.applyNumericMask(input);
      Store.set(key, n === '' ? '' : n);
    } else {
      Store.set(key, input.value);
    }

    /* 사용자가 손댄 순간 '이전 홀' 표시를 벗긴다 */
    var wrap = input.closest ? input.closest('.input-wrap') : null;
    if (wrap && wrap.classList.contains('is-carried')) wrap.classList.remove('is-carried');
  });

  /* 세그먼트 토글 */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.seg-btn') : null;
    if (!btn) return;
    var group = btn.closest('[data-toggle]');
    if (!group) return;
    var key = group.getAttribute('data-toggle');
    var value = btn.getAttribute('data-value');
    if (Store.get(key) === value) return;

    /* 통합보증으로 처음 전환할 때 양가 보증 합계를 옮겨 담는다 */
    if (key === 'guaranteeMode' && value === 'unified' && !Store.get('unifiedGuarantee')) {
      var sum = Fmt.int(Store.get('groomGuarantee')) + Fmt.int(Store.get('brideGuarantee'));
      if (sum > 0) Store.set('unifiedGuarantee', sum, { silent: true });
    }
    if (key === 'guaranteeMode' && value === 'separate' &&
        !Store.get('groomGuarantee') && !Store.get('brideGuarantee')) {
      var uni = Fmt.int(Store.get('unifiedGuarantee'));
      if (uni > 0) {
        Store.set('groomGuarantee', Math.ceil(uni / 2), { silent: true });
        Store.set('brideGuarantee', Math.floor(uni / 2), { silent: true });
      }
    }

    Store.set(key, value);
    writeInputs();
    renderLive();
  });

  /* ── 라이브 요약 ──────────────────────────────────────────────────────── */
  function renderLive() {
    var s = Store.all();
    var r = Calc.run(s);

    $$('[data-live="total"]').forEach(function (n) { n.textContent = Fmt.won(r.grandTotal); });
    $$('[data-live="per"]').forEach(function (n) { n.textContent = Fmt.won(r.perPerson); });
    $$('[data-live="billed"]').forEach(function (n) { n.textContent = Fmt.people(r.billed); });

    /* Step 1 */
    var box1 = $('[data-live-box="step1"]');
    if (box1) {
      /* 두 기준을 나란히 보여줘야 어느 쪽을 고를지 판단할 수 있다 */
      box1.innerHTML = ledger('인원 확인', r.separate ? '각보증' : '통합보증', [
        { label: '청구인원', value: Fmt.people(r.billed),
          memo: r.separate
            ? '양가 각각 MAX(보증, 참석)의 합'
            : 'MAX(총 보증 ' + Fmt.comma(r.guaranteeTotal) + ', 총 참석 ' + Fmt.comma(r.attendedAdults) + ')' },
        { label: '예상 참석', value: Fmt.people(r.attendedTotal),
          memo: r.childCount > 0 ? '성인 ' + Fmt.comma(r.attendedAdults) + ' + 아동 ' + Fmt.comma(r.childCount) : '성인 기준' },
        { label: '1인당 · 청구인원 기준', value: r.billed > 0 ? Fmt.won(r.perPersonBilled) : '보증인원 입력 필요', type: 'sub' },
        { label: '1인당 · 예상 참석 기준', value: r.attendedTotal > 0 ? Fmt.won(r.perPersonAttended) : '참석인원 입력 필요', type: 'sub' }
      ], '결과에는 <b>' + (r.perBasis === 'attended' ? '예상 참석' : '청구인원') + ' 기준</b>이 쓰입니다.');
    }

    /* Step 2 */
    var box2 = $('[data-live-box="step2"]');
    if (box2) {
      var rows2 = [
        { label: '성인 식대', value: Fmt.won(r.mealAdult),
          memo: Fmt.comma(r.billed) + '명 × ' + Fmt.won(r.adultUnit) }
      ];
      if (r.childCount > 0) {
        rows2.push({ label: '아동 식대', value: Fmt.won(r.mealChild),
          memo: Fmt.comma(r.childCount) + '명 × ' + Fmt.won(r.childUnit) });
      }
      rows2.push({ label: '식대 합계', value: Fmt.won(r.mealTotal), type: 'total' });
      box2.innerHTML = ledger('식대 소계', s.mealVatMode === 'excluded' ? 'VAT 별도 10% 반영' : 'VAT 포함가', rows2);
    }

    /* Step 3 */
    var box3 = $('[data-live-box="step3"]');
    if (box3) {
      box3.innerHTML = ledger('대관 · 꽃 · 주류 소계', '', [
        { label: '대관료 · 홀 사용료', value: Fmt.won(r.venue) },
        { label: '꽃장식', value: Fmt.won(r.flower) },
        { label: '주류 · 음료', value: Fmt.won(r.drinkTotal),
          memo: Fmt.comma(r.billed) + '명 × ' + Fmt.won(r.drinkUnit) },
        { label: '폐백 · 진행비 · 주차', value: Fmt.won(r.etc) },
        { label: '소계', value: Fmt.won(r.venue + r.flower + r.drinkTotal + r.etc), type: 'total' }
      ]);
    }

    /* Step 4 */
    var box4 = $('[data-live-box="step4"]');
    if (box4) {
      var rows4 = [];
      if (s.optionMode === 'detail') {
        for (var i = 0; i < CONFIG.optionDetailFields.length; i++) {
          var f4 = CONFIG.optionDetailFields[i];
          var v4 = Fmt.num(s[f4.key]);
          if (v4 > 0) rows4.push({ label: f4.label, value: Fmt.won(v4), type: 'sub' });
        }
      }
      rows4.push({ label: '필수옵션 합계', value: Fmt.won(r.options), type: 'total' });
      box4.innerHTML = ledger('필수옵션', s.otherVatMode === 'excluded' ? 'VAT 별도 10% 반영' : 'VAT 포함가', rows4);
    }

    /* Step 5 */
    var box5 = $('[data-live-box="step5"]');
    if (box5) {
      var rows5 = [
        { label: '식대', value: Fmt.won(r.mealTotal) },
        { label: '식대 외 항목', value: Fmt.won(r.otherTotal) }
      ];
      if (r.discount > 0) rows5.push({ label: '할인 · 지원', value: '-' + Fmt.won(r.discount), type: 'minus' });
      rows5.push({ label: '총 예상비용', value: Fmt.won(r.grandTotal), type: 'total' });
      if (r.hasGift) {
        rows5.push({ label: '예상 축의금', value: '-' + Fmt.won(r.giftTotal), type: 'minus',
          memo: Fmt.won(r.giftPerPerson) + ' × 예상 참석 ' + Fmt.comma(r.attendedAdults) + '명' });
        rows5.push({ label: '순수 부담액', value: Fmt.won(r.netBurden), type: 'total' });
      }
      box5.innerHTML = ledger('최종 합계', r.vatAdded > 0 ? ('별도 부가세 ' + Fmt.won(r.vatAdded) + ' 포함') : 'VAT 포함가 기준', rows5);
    }

    /* 상단 안내 — 예시값 상태 / 이전 홀에서 값을 물려받은 상태 */
    var carried = Store.carriedCount();
    if (Store.isExampleData()) {
      el.notice.removeAttribute('hidden');
      el.notice.className = 'notice';
      $('.notice-text', el.notice).innerHTML =
        '<b>금액 칸은 예시입니다.</b> 받아온 견적서 숫자로 덮어쓰세요. 참석인원은 비어 있습니다.';
      $('#btnClearAll').textContent = '전부 비우기';
    } else if (carried > 0) {
      el.notice.removeAttribute('hidden');
      el.notice.className = 'notice is-carried';
      $('.notice-text', el.notice).innerHTML =
        '<b>' + carried + '개 칸을 이전 홀에서 가져왔습니다.</b> 표시된 칸을 확인하고 다르면 고치세요.';
      $('#btnClearAll').textContent = '가져온 값 비우기';
    } else {
      el.notice.setAttribute('hidden', '');
    }

    return r;
  }

  /* ── 뷰 전환 ──────────────────────────────────────────────────────────── */
  function setView(next, push) {
    view = next;
    document.body.setAttribute('data-view', next);
    el.viewWizard.hidden = next !== 'wizard';
    el.viewResult.hidden = next !== 'result';
    el.viewCompare.hidden = next !== 'compare';

    if (next === 'wizard') { renderDockWizard(); renderLive(); }
    if (next === 'result') { renderResult(); renderDockResult(); }
    if (next === 'compare') { renderCompare(); renderDockCompare(); }

    if (push !== false) pushHistory();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function pushHistory() {
    if (suppressHistory) return;
    try { history.pushState({ view: view }, ''); } catch (e) { /* file:// 등 무시 */ }
  }

  window.addEventListener('popstate', function (e) {
    var st = e.state;
    suppressHistory = true;
    setView(st && st.view ? st.view : 'wizard', false);
    suppressHistory = false;
  });

  /* ── 하단 바 ──────────────────────────────────────────────────────────── */
  function icon(id) { return '<svg class="ic" aria-hidden="true"><use href="#' + id + '"/></svg>'; }

  function renderDockWizard() {
    el.dockLive.hidden = false;
    el.dockActions.innerHTML =
        '<button type="button" class="btn btn-primary" id="btnNext"><span class="btn-label">결과 보기</span>'
      +   '<span class="btn-orb" aria-hidden="true">' + icon('i-arrow-right') + '</span></button>';
    el.btnNext = $('#btnNext');
  }

  function renderDockResult() {
    el.dockLive.hidden = false;
    var full = Store.compareFull();
    el.dockActions.innerHTML =
        '<button type="button" class="btn btn-quiet" data-act="edit">' + icon('i-edit') + '<span class="btn-label">수정</span></button>'
      + '<button type="button" class="btn btn-primary" data-act="addCompare"' + (full ? ' disabled' : '') + '>'
      +   '<span class="btn-label">' + (full ? '비교함 가득참' : '비교함에 담기') + '</span>'
      +   '<span class="btn-orb" aria-hidden="true">' + icon(full ? 'i-check' : 'i-stack') + '</span></button>';
  }

  function renderDockCompare() {
    el.dockLive.hidden = true;
    el.dockActions.innerHTML =
        '<button type="button" class="btn btn-quiet" data-act="backToResult">' + icon('i-arrow-left') + '<span class="btn-label">돌아가기</span></button>'
      + '<button type="button" class="btn btn-primary" data-act="nextHall"><span class="btn-label">새 홀 입력하기</span>'
      +   '<span class="btn-orb" aria-hidden="true">' + icon('i-plus') + '</span></button>';
  }

  /* ── 결과 ─────────────────────────────────────────────────────────────── */
  function breakdownMarkup(r) {
    var rows = [];
    for (var i = 0; i < r.breakdown.length; i++) {
      var b = r.breakdown[i];
      rows.push({
        label: b.label,
        memo: b.memo,
        value: (b.amount < 0 ? '-' : '') + Fmt.won(Math.abs(b.amount)),
        type: b.type
      });
    }
    var note = r.vatAdded > 0
      ? '위 금액에는 별도로 붙은 부가세 <b>' + Fmt.won(r.vatAdded) + '</b>이 포함되어 있습니다.'
      : '견적서 금액에 부가세가 이미 포함된 것으로 계산했습니다.';
    return '<section class="doc-section reveal"><div class="ledger">'
         + ledger('항목별 내역', '부가세 반영 후', rows, note)
         + '</div></section>';
  }

  function netMarkup(r) {
    if (!r.hasGift) return '';
    return '<section class="net reveal">'
         +   '<p class="net-k">순수 부담액</p>'
         +   '<p class="net-v' + (r.netBurden < 0 ? ' is-negative' : '') + '">' + Fmt.won(r.netBurden) + '</p>'
         +   '<p class="net-desc">총 예상비용 ' + Fmt.won(r.grandTotal) + '에서 예상 축의금 ' + Fmt.won(r.giftTotal)
         +     ' (1인 ' + Fmt.won(r.giftPerPerson) + ' × 예상 참석 ' + Fmt.comma(r.attendedAdults) + '명)을 뺀 금액입니다.</p>'
         + '</section>';
  }

  function assumptionsMarkup(r) {
    return '<details class="assump reveal">'
         +   '<summary>이 계산이 세운 가정 보기</summary>'
         +   '<ul class="assump-body">'
         +     '<li>청구인원은 ' + (r.separate ? '양가 각각 MAX(보증, 참석)을 더해' : 'MAX(총 보증, 총 참석)으로') + ' 구했습니다.</li>'
         +     '<li>식대와 주류·음료는 예상 참석이 아니라 <b>청구인원</b>에 곱했습니다.</li>'
         +     '<li>1인당 실질단가는 총 예상비용을 <b>'
         +       (r.perBasis === 'attended' ? '예상 참석' : '청구인원') + ' ' + Fmt.comma(r.perPersonCount) + '명</b>으로 나눈 값입니다.'
         +       ' 기준은 1번 섹션에서 바꿀 수 있습니다.</li>'
         +     '<li>아동 식대는 청구인원과 별개로 추가 합산했습니다.</li>'
         +     (r.hasGift ? '<li>예상 축의금은 예상 참석 성인 ' + Fmt.comma(r.attendedAdults) + '명 기준입니다.</li>' : '')
         +     '<li>부가세율은 10% 고정입니다.</li>'
         +   '</ul>'
         + '</details>';
  }

  function renderResult() {
    var s = Store.all();
    var r = Calc.run(s);
    var name = (s.hallName || '').trim() || '이름 없는 웨딩홀';

    /* 고른 기준을 그대로 쓴다. 나눌 인원이 비었으면 대신 계산하지 않고 입력을 요청한다. */
    var perNote;
    if (r.perPersonMissing) {
      perNote = (r.perBasis === 'attended' ? '예상 참석인원' : '보증인원') + '을 입력하면 계산됩니다';
    } else {
      perNote = (r.perBasis === 'attended' ? '예상 참석' : '청구인원') + ' '
              + Fmt.comma(r.perPersonCount) + '명 기준';
      if (r.attendedTotal > 0 && r.billed !== r.attendedTotal) {
        perNote += '<br>' + (r.perBasis === 'attended' ? '청구인원' : '예상 참석') + ' 기준이면 '
                 + Fmt.won(r.perBasis === 'attended' ? r.perPersonBilled : r.perPersonAttended);
      }
    }

    el.resultRoot.innerHTML =
        '<div class="doc">'
      +   '<div class="doc-head reveal">'
      +     '<span class="doc-issuer">SDING 검산</span>'
      +     '<span class="doc-target">' + esc(name) + '</span>'
      +     '<span class="doc-basis">' + (r.separate ? '각보증' : '통합보증') + ' · 청구 ' + Fmt.comma(r.billed) + '명</span>'
      +   '</div>'

      +   '<div class="doc-total-block reveal">'
      +     '<p class="doc-total-k">총 예상비용</p>'
      +     '<p class="doc-total"><span id="totalCount">' + Fmt.comma(r.grandTotal) + '</span><span class="won">원</span></p>'
      +     '<p class="doc-line">청구인원 <b>' + Fmt.comma(r.billed) + '명</b> 기준으로 항목별 단가를 합산한 금액입니다.</p>'
      +   '</div>'

      +   '<div class="doc-metrics reveal">'
      +     '<div class="doc-metric is-accent">'
      +       '<span class="doc-metric-k">1인당 실질단가</span>'
      +       '<strong class="doc-metric-v">' + (r.perPersonMissing ? '—' : Fmt.won(r.perPerson)) + '</strong>'
      +       '<span class="doc-metric-note">' + perNote + '</span>'
      +     '</div>'
      +     '<div class="doc-metric">'
      +       '<span class="doc-metric-k">청구인원</span>'
      +       '<strong class="doc-metric-v">' + Fmt.comma(r.billed) + '명</strong>'
      +       '<span class="doc-metric-note">식대 · 주류가 붙는 인원</span>'
      +     '</div>'
      +   '</div>'

      +   breakdownMarkup(r)
      +   netMarkup(r)

      +   '<div class="actions reveal">'
      +     '<div class="actions-row">'
      +       '<button type="button" class="btn btn-outline" data-act="copy">' + icon('i-copy') + '<span class="btn-label">복사</span></button>'
      +       '<button type="button" class="btn btn-outline" data-act="image">' + icon('i-image') + '<span class="btn-label">이미지</span></button>'
      +       '<button type="button" class="btn btn-outline" data-act="share">' + icon('i-share') + '<span class="btn-label">공유</span></button>'
      +     '</div>'
      +     '<button type="button" class="btn btn-solid btn-block" data-act="nextHall">'
      +       icon('i-plus') + '<span class="btn-label">다른 홀도 계산해서 비교하기</span></button>'
      +   '</div>'

      +   assumptionsMarkup(r)
      + '</div>';

    observeReveals(el.resultRoot);
    countUp($('#totalCount'), r.grandTotal);
  }

  /* 총액 카운트업 — 이 페이지의 유일한 연출 */
  function countUp(node, target) {
    if (!node) return;
    if (reduceMotion || target <= 0) { node.textContent = Fmt.comma(target); return; }
    var dur = 700, start = null;
    node.textContent = '0';
    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = Fmt.comma(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ── 비교함 ───────────────────────────────────────────────────────────── */
  function renderCompare() {
    var list = Store.compareList();

    if (!list.length) {
      el.compareRoot.innerHTML =
          '<div class="compare">'
        +   '<div class="compare-head">'
        +     '<h2 class="compare-title">비교함</h2>'
        +     '<p class="compare-sub">최대 ' + CONFIG.MAX_COMPARE + '개 홀을 나란히 놓고 1인당 실질단가로 비교합니다.</p>'
        +   '</div>'
        +   '<div class="empty">'
        +     '<p class="empty-title">아직 담은 홀이 없습니다</p>'
        +     '<p class="empty-desc">견적서 숫자를 넣고 결과 화면에서 <b>비교함에 담기</b>를 누르면<br>여기에 카드로 쌓입니다.</p>'
        +   '</div>'
        + '</div>';
      return;
    }

    var computed = list.map(function (item) {
      return { item: item, r: Calc.run(item.state) };
    });

    var best = null;
    for (var i = 0; i < computed.length; i++) {
      var pp = computed[i].r.perPerson;
      if (pp > 0 && (best === null || pp < computed[best].r.perPerson)) best = i;
    }

    var cards = computed.map(function (c, idx) {
      var r = c.r, item = c.item;
      var isBest = (idx === best) && computed.length > 1;

      var diff = '';
      if (best !== null && idx !== best && computed[best].r.perPerson > 0) {
        var d = r.perPerson - computed[best].r.perPerson;
        if (Math.abs(d) >= 1) {
          diff = '<span class="cmp-diff ' + (d > 0 ? 'up' : 'down') + '">'
               + (d > 0 ? '+' : '−') + Fmt.comma(Math.abs(d)) + '</span>';
        }
      }

      var rows = r.breakdown.map(function (b) {
        return {
          label: b.label, memo: '', type: b.type,
          value: (b.amount < 0 ? '-' : '') + Fmt.won(Math.abs(b.amount))
        };
      });

      return '<article class="cmp' + (isBest ? ' is-best' : '') + '">'
           +   '<div class="cmp-top">'
           +     '<div><h3 class="cmp-name">' + esc(item.name) + '</h3>'
           +       (isBest ? '<span class="cmp-flag">1인당 최저</span>' : '') + '</div>'
           +     '<button type="button" class="cmp-del" data-act="removeCompare" data-id="' + esc(item.id) + '" aria-label="' + esc(item.name) + ' 비교함에서 빼기">'
           +       icon('i-close') + '</button>'
           +   '</div>'
           +   '<div class="cmp-metrics">'
           +     '<div class="cmp-metric is-accent"><span class="cmp-k">1인당 실질단가</span>'
           +       '<strong class="cmp-v">' + Fmt.won(r.perPerson) + diff + '</strong></div>'
           +     '<div class="cmp-metric"><span class="cmp-k">총 예상비용</span>'
           +       '<strong class="cmp-v">' + Fmt.korShort(r.grandTotal) + '</strong></div>'
           +     '<div class="cmp-metric"><span class="cmp-k">청구인원</span>'
           +       '<strong class="cmp-v">' + Fmt.comma(r.billed) + '명</strong></div>'
           +   '</div>'
           +   '<details class="cmp-detail"><summary>전체 내역 보기</summary>'
           +     '<div class="ledger">' + ledgerRows(rows) + '</div>'
           +     '<button type="button" class="btn btn-outline btn-block" style="margin-top:12px" data-act="editCompare" data-id="' + esc(item.id) + '">'
           +       icon('i-edit') + '<span class="btn-label">이 홀 수정하기</span></button>'
           +   '</details>'
           + '</article>';
    }).join('');

    el.compareRoot.innerHTML =
        '<div class="compare">'
      +   '<div class="compare-head">'
      +     '<h2 class="compare-title">비교함</h2>'
      +     '<p class="compare-sub">' + list.length + ' / ' + CONFIG.MAX_COMPARE + '개. 옆으로 밀어 비교하세요. '
      +       (best !== null && computed.length > 1 ? '1인당 실질단가가 가장 낮은 곳은 <b>' + esc(computed[best].item.name) + '</b>입니다.' : '')
      +     '</p>'
      +   '</div>'
      +   '<div class="swipe">' + cards + '</div>'
      +   '<div class="compare-note">'
      +     '<b>비교함은 이 브라우저에만 저장됩니다.</b> 기기를 바꾸거나 한동안 안 들어오면 사라질 수 있어요. '
      +     '아래 링크를 복사해 두면 어디서든 그대로 열립니다.'
      +   '</div>'
      +   '<div class="compare-actions">'
      +     '<button type="button" class="btn btn-solid btn-block" data-act="copyLink">'
      +       icon('i-share') + '<span class="btn-label">비교함 링크 복사</span></button>'
      +     '<button type="button" class="btn btn-outline btn-block" data-act="copyCompare">'
      +       icon('i-copy') + '<span class="btn-label">비교표 복사</span></button>'
      +     '<button type="button" class="btn btn-outline btn-block" data-act="clearCompare">'
      +       icon('i-redo') + '<span class="btn-label">비교함 비우기</span></button>'
      +   '</div>'
      + '</div>';
  }

  function compareText() {
    var list = Store.compareList();
    var L = ['[Sding 웨딩홀 견적 검산기] 비교표', ''];
    list.forEach(function (item, i) {
      var r = Calc.run(item.state);
      L.push((i + 1) + '. ' + item.name);
      L.push('   총 예상비용   ' + Fmt.won(r.grandTotal));
      L.push('   1인당 실질단가 ' + Fmt.won(r.perPerson));
      L.push('   청구/참석     ' + Fmt.comma(r.billed) + '명 / ' + Fmt.comma(r.attendedTotal) + '명');
      L.push('');
    });
    L.push('※ 참고용 계산입니다. 최종 금액은 계약서 원문으로 확인하세요.');
    return L.join('\n');
  }

  /* ── 스크롤 등장 ──────────────────────────────────────────────────────── */
  function observeReveals(root) {
    var nodes = $$('.reveal', root);
    if (reduceMotion || !('IntersectionObserver' in window)) {
      nodes.forEach(function (n) { n.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });

    nodes.forEach(function (n, i) {
      n.style.setProperty('--d', Math.min(240, i * 45) + 'ms');
      io.observe(n);
    });
    /* 첫 화면에 이미 들어와 있는 요소는 즉시 */
    requestAnimationFrame(function () {
      nodes.forEach(function (n) {
        if (n.getBoundingClientRect().top < window.innerHeight) n.classList.add('is-in');
      });
    });
  }

  /* ── 액션 ─────────────────────────────────────────────────────────────── */
  var actions = {
    edit: function () { setView('wizard'); },

    addCompare: function () {
      var s = Store.all();
      var r = Calc.run(s);
      if (r.grandTotal <= 0) { toast('견적서 숫자를 먼저 입력해 주세요'); return; }
      if (Store.compareFull()) { toast('비교함은 최대 ' + CONFIG.MAX_COMPARE + '개까지 담을 수 있어요'); return; }
      var res = Store.compareAdd(s.hallName);
      if (res.ok) {
        toast('비교함에 담았습니다 (' + Store.compareCount() + '/' + CONFIG.MAX_COMPARE + ')');
        viewBeforeCompare = 'result';
        setView('compare');
      }
    },

    removeCompare: function (btn) {
      var prevList = Store.compareList().slice();
      Store.compareRemove(btn.getAttribute('data-id'));
      renderCompare();
      toast('비교함에서 뺐습니다', {
        undo: function () { Store.compareRestore(prevList); renderCompare(); toast('되돌렸습니다'); }
      });
    },

    editCompare: function (btn) {
      var item = Store.compareGet(btn.getAttribute('data-id'));
      if (!item) return;
      Store.loadFrom(item.state);
      Store.compareRemove(item.id);
      writeInputs();
      renderLive();
      setView('wizard');
      toast('입력값을 불러왔습니다');
    },

    clearCompare: function () {
      if (!Store.compareCount()) return;
      var prevList = Store.compareList().slice();
      Store.compareClear();
      renderCompare();
      toast('비교함을 비웠습니다', {
        undo: function () { Store.compareRestore(prevList); renderCompare(); toast('되돌렸습니다'); }
      });
    },

    copyCompare: function () {
      Share.copyText(compareText())
        .then(function () { toast('비교표를 복사했습니다'); })
        .catch(function () { toast('복사에 실패했습니다'); });
    },

    /* 비교함을 통째로 주소에 실어 복사한다. 링크 자체가 백업이다. */
    copyLink: function () {
      var list = Store.compareList();
      if (!list.length) { toast('비교함이 비어 있습니다'); return; }
      var link = Share.buildCompareLink(list);
      Share.copyText(link)
        .then(function () { toast('링크를 복사했습니다. 나에게 보내두세요'); })
        .catch(function () { toast('복사에 실패했습니다'); });
    },

    nextHall: function () {
      Store.startNextHall();
      writeInputs();
      renderLive();
      setView('wizard');
      var n = Store.carriedCount();
      toast(n > 0 ? n + '개 칸을 이전 홀에서 가져왔습니다' : '새 홀 입력을 시작합니다');
    },

    backToResult: function () { setView(viewBeforeCompare || 'wizard'); },

    copy: function () {
      var s = Store.all();
      Share.copyText(Share.buildText(s, Calc.run(s)))
        .then(function () { toast('결과를 복사했습니다'); })
        .catch(function () { toast('복사에 실패했습니다'); });
    },

    image: function (btn) {
      var s = Store.all();
      btn.disabled = true;
      toast('이미지를 만드는 중…');
      Share.saveImage(s, Calc.run(s))
        .then(function () { toast('이미지를 저장했습니다'); })
        .catch(function () { toast('이미지 저장에 실패했습니다'); })
        .then(function () { btn.disabled = false; });
    },

    share: function (btn) {
      var s = Store.all();
      btn.disabled = true;
      Share.shareResult(s, Calc.run(s))
        .then(function (how) {
          if (how === 'copied') toast('공유를 지원하지 않아 복사했습니다');
          else if (how !== 'cancelled') toast('공유 시트를 열었습니다');
        })
        .catch(function () { toast('공유에 실패했습니다'); })
        .then(function () { btn.disabled = false; });
    }
  };

  document.addEventListener('click', function (e) {
    var target = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!target) return;
    var act = target.getAttribute('data-act');
    if (actions[act]) { e.preventDefault(); actions[act](target); }
  });

  el.dockActions.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('button') : null;
    if (!btn || view !== 'wizard') return;
    if (btn.id === 'btnNext') {
      var r = Calc.run(Store.all());
      if (r.grandTotal <= 0) { toast('견적서 숫자를 먼저 입력해 주세요'); return; }
      setView('result');
    }
  });

  var viewBeforeCompare = 'wizard';
  el.btnCompare.addEventListener('click', function () {
    if (view === 'compare') { setView(viewBeforeCompare); return; }
    viewBeforeCompare = view;
    setView('compare');
  });

  el.btnClearAll.addEventListener('click', function () {
    var snapshot = {};
    var s = Store.all();
    for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) snapshot[k] = s[k];
    var wasExample = Store.isExampleData();
    var wasCarried = Store.carriedCount() > 0;

    /* 물려받은 값만 지우는 경우와 전부 비우는 경우를 구분한다 */
    if (!wasExample && wasCarried) {
      CONFIG.carryOverFields.forEach(function (key) {
        if (Store.isCarried(key)) Store.set(key, '', { silent: true });
      });
      Store.clearCarried();
      writeInputs();
      renderLive();
      toast('가져온 값을 비웠습니다', {
        undo: function () { Store.loadFrom(snapshot); writeInputs(); renderLive(); toast('되돌렸습니다'); }
      });
      return;
    }

    Store.clearAll();
    writeInputs();
    renderLive();
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });

    toast('입력값을 비웠습니다', {
      undo: function () {
        if (wasExample) Store.loadExample(); else Store.loadFrom(snapshot);
        writeInputs();
        renderLive();
        toast('되돌렸습니다');
      }
    });
  });

  /* ── 배지 ─────────────────────────────────────────────────────────────── */
  function renderBadge() {
    var n = Store.compareCount();
    el.badge.textContent = String(n);
    el.btnCompare.classList.toggle('is-empty', n === 0);
  }

  /* ── 초기화 ───────────────────────────────────────────────────────────── */
  Store.subscribe(function (reason) {
    if (reason === 'compare') renderBadge();
    if (reason === 'field') renderLive();
  });

  /* 공유 링크로 들어온 경우: 비교함을 복원하고 주소는 깨끗하게 되돌린다.
     되돌리기를 붙여 기존 비교함을 실수로 덮어써도 복구할 수 있게 한다. */
  var imported = null;
  try { imported = Share.readCompareLink(window.location.hash); } catch (e) { imported = null; }

  if (imported && imported.length) {
    var before = Store.compareList().slice();
    Store.compareRestore(imported);
    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* noop */ }
  }

  writeInputs();
  renderLive();
  renderBadge();
  renderDockWizard();
  setView(imported && imported.length ? 'compare' : 'wizard', false);
  try { history.replaceState({ view: view }, ''); } catch (e) { /* noop */ }

  if (imported && imported.length) {
    var restoreTo = before;
    setTimeout(function () {
      toast('링크에서 ' + imported.length + '개를 불러왔습니다', {
        undo: function () {
          Store.compareRestore(restoreTo);
          renderCompare();
          toast('되돌렸습니다');
        }
      });
    }, 400);
  }

  if (!Store.storageAvailable) {
    setTimeout(function () { toast('이 브라우저에서는 입력값이 저장되지 않습니다'); }, 900);
  }
})();
