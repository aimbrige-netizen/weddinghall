/* =============================================================================
   share.js — 결과 복사 · 결과 이미지 생성 · 공유

   이미지는 외부 라이브러리 없이 Canvas 2D 로 직접 그립니다(html2canvas 등 무의존).
   로고는 CONFIG.logoPaths 의 Path2D 를 그대로 찍어 캔버스 오염(tainting)이 없습니다.
   ========================================================================== */

var Share = (function () {

  var W = 1080, H = 1350, PAD = 76;

  var C = {
    paper: '#F7F6F3',
    sheet: '#FFFFFF',
    ink:   '#0B0B0C',
    ink2:  '#3B3C40',
    ink3:  '#6B6C73',
    rule:  '#E3E1DC',
    orange:'#FF5416',
    orangeInk: '#C63B00',
    rust:  '#B83200',
    rustTint: '#FFD9C9'
  };

  var FONT = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

  function f(weight, size) { return weight + ' ' + size + 'px ' + FONT; }

  /* ── 텍스트 요약 ──────────────────────────────────────────────────────── */
  function buildText(s, r) {
    var name = (s.hallName || '').trim() || '이름 없는 웨딩홀';
    var L = [];
    L.push('[Sding 웨딩홀 견적 검산기]');
    L.push(name);
    L.push('');
    L.push('총 예상비용    ' + Fmt.won(r.grandTotal));
    L.push('1인당 실질단가  ' + Fmt.won(r.perPerson)
      + ' (' + (r.perBasis === 'attended' ? '예상 참석' : '청구인원') + ' ' + Fmt.comma(r.perPersonCount) + '명 기준)');
    L.push('');
    L.push('· 청구인원 ' + Fmt.people(r.billed) + ' / 예상참석 ' + Fmt.people(r.attendedTotal));
    L.push('· 보증방식 ' + (r.separate ? '각보증' : '통합보증'));
    L.push('');
    L.push('── 내역 ──────────────');
    for (var i = 0; i < r.breakdown.length; i++) {
      var b = r.breakdown[i];
      if (b.type === 'sub') continue;
      if (b.type === 'total') {
        L.push('──────────────────────');
        L.push(b.label + '  ' + Fmt.won(b.amount));
      } else {
        L.push('· ' + b.label + '  ' + Fmt.won(b.amount));
      }
    }
    if (r.vatAdded > 0) L.push('  (이 중 별도 부가세 ' + Fmt.won(r.vatAdded) + ')');
    if (r.hasGift) {
      L.push('');
      L.push('예상 축의금    ' + Fmt.won(r.giftTotal) + ' (' + Fmt.won(r.giftPerPerson) + ' × ' + Fmt.people(r.attendedAdults) + ')');
      L.push('순수 부담액    ' + Fmt.won(r.netBurden));
    }
    L.push('');
    L.push('※ 참고용 계산입니다. 최종 금액과 조건은 계약서 원문으로 확인하세요.');
    try { L.push(window.location.href.split('#')[0]); } catch (e) { /* noop */ }
    return L.join('\n');
  }

  /* ── 링크로 내보내기 ──────────────────────────────────────────────────────
     비교함을 주소(hash)에 통째로 실어 사용자가 자기 카톡·북마크에 보관하게 한다.
     서버가 없으므로 링크 자체가 저장소다. 기기가 바뀌어도, 사파리가 7일 뒤
     저장소를 비워도, 도메인이 바뀌어도 링크만 있으면 복원된다.

     인코딩: {v, h:[[값1, 값2, ...], ...]} → JSON → UTF-8 → base64url
     값은 CONFIG.shareFieldOrder 순서대로만 싣고 키 이름은 싣지 않는다(용량). */

  function b64urlEncode(str) {
    var bin = '', bytes, i;
    if (window.TextEncoder) {
      bytes = new TextEncoder().encode(str);
      for (i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    } else {
      bin = unescape(encodeURIComponent(str));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(s) {
    var t = s.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    var bin = atob(t);
    if (window.TextDecoder) {
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(escape(bin));
  }

  function packState(state) {
    var order = CONFIG.shareFieldOrder;
    var row = [];
    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      var def = CONFIG.fields[key];
      var v = state[key];
      if (def && def.type === 'enum') {
        var map = CONFIG.enumCodes[key] || {};
        row.push(map[v] === undefined ? 0 : map[v]);
      } else if (def && def.type === 'number') {
        row.push(v === '' || v === undefined || v === null ? 0 : Fmt.int(v));
      } else {
        row.push(v === undefined || v === null ? '' : String(v));
      }
    }
    /* 뒤쪽 빈 값은 잘라내 링크를 줄인다 (복원 시 기본값으로 채움) */
    while (row.length && (row[row.length - 1] === 0 || row[row.length - 1] === '')) row.pop();
    return row;
  }

  function unpackState(row) {
    var order = CONFIG.shareFieldOrder;
    var state = {};
    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      var def = CONFIG.fields[key];
      var v = (row && i < row.length) ? row[i] : undefined;
      if (def && def.type === 'enum') {
        var map = CONFIG.enumCodes[key] || {};
        var found = def.def;
        for (var name in map) {
          if (Object.prototype.hasOwnProperty.call(map, name) && map[name] === v) { found = name; break; }
        }
        state[key] = found;
      } else if (def && def.type === 'number') {
        state[key] = (v === undefined || v === 0) ? '' : Fmt.int(v);
      } else {
        state[key] = v === undefined ? '' : String(v);
      }
    }
    return state;
  }

  /* 비교함 → 공유 가능한 전체 주소 */
  function buildCompareLink(list) {
    var payload = { v: CONFIG.SHARE_VERSION, h: [] };
    for (var i = 0; i < list.length; i++) {
      payload.h.push([String(list[i].name || '')].concat(packState(list[i].state)));
    }
    var base;
    try { base = window.location.href.split('#')[0]; } catch (e) { base = ''; }
    return base + '#h=' + b64urlEncode(JSON.stringify(payload));
  }

  /* 주소 → 비교함 배열 (실패하면 null) */
  function readCompareLink(hash) {
    if (!hash) return null;
    var m = String(hash).match(/[#&]h=([A-Za-z0-9\-_]+)/);
    if (!m) return null;
    try {
      var payload = JSON.parse(b64urlDecode(m[1]));
      if (!payload || Object.prototype.toString.call(payload.h) !== '[object Array]') return null;
      var out = [];
      for (var i = 0; i < payload.h.length && out.length < CONFIG.MAX_COMPARE; i++) {
        var row = payload.h[i];
        if (Object.prototype.toString.call(row) !== '[object Array]') continue;
        out.push({
          id: 'lnk' + i + '_' + Math.floor(Math.random() * 100000).toString(36),
          name: String(row[0] || '이름 없는 홀').slice(0, 40),
          state: unpackState(row.slice(1))
        });
      }
      return out.length ? out : null;
    } catch (e) {
      return null;
    }
  }

  /* ── 클립보드 ─────────────────────────────────────────────────────────── */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('copy failed'));
      } catch (err) { reject(err); }
    });
  }

  /* ── 캔버스 헬퍼 ──────────────────────────────────────────────────────── */
  /* letterSpacing 미지원 브라우저를 위한 수동 자간.
     글자를 하나씩 찍으므로 textAlign 을 직접 보정해야 한다.
     (right/center 인 상태로 그대로 찍으면 각 글자가 자기 x의 왼쪽으로 그려지는데
      커서는 오른쪽으로 전진해 글자끼리 겹친다 — 'SDING'의 I가 N에 덮이던 버그) */
  function tracked(ctx, text, x, y, spacing) {
    if (!spacing) { ctx.fillText(text, x, y); return; }

    var total = 0, i;
    for (i = 0; i < text.length; i++) total += ctx.measureText(text[i]).width + spacing;
    total -= spacing;

    var align = ctx.textAlign;
    var cx = x;
    if (align === 'right') cx = x - total;
    else if (align === 'center') cx = x - total / 2;

    ctx.textAlign = 'left';
    for (i = 0; i < text.length; i++) {
      ctx.fillText(text[i], cx, y);
      cx += ctx.measureText(text[i]).width + spacing;
    }
    ctx.textAlign = align;
  }

  function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  function rule(ctx, y, color, weight) {
    ctx.fillStyle = color || C.rule;
    ctx.fillRect(PAD, y, W - PAD * 2, weight || 1);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawLogo(ctx, x, y, targetW, color) {
    var scale = targetW / CONFIG.logoViewBox.w;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    for (var i = 0; i < CONFIG.logoPaths.length; i++) {
      ctx.fill(new Path2D(CONFIG.logoPaths[i]));
    }
    ctx.restore();
  }

  /* ── 결과 이미지 ──────────────────────────────────────────────────────── */
  function renderCanvas(s, r) {
    var dpr = 2;
    var cv = document.createElement('canvas');
    cv.width = W * dpr;
    cv.height = H * dpr;
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.textBaseline = 'alphabetic';

    var innerW = W - PAD * 2;

    /* 바탕 */
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, H);

    /* 상단 먹색 밴드 */
    var bandH = 150;
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, 0, W, bandH);
    drawLogo(ctx, PAD, 52, 180, C.orange);
    ctx.fillStyle = '#DEDEE2';
    ctx.font = f(550, 27);
    ctx.textAlign = 'right';
    ctx.fillText('견적 검산기', W - PAD, bandH / 2 + 10);
    ctx.textAlign = 'left';

    /* ── 수직 리듬 ─────────────────────────────────────────────────────
       캔버스에는 line-height가 없으므로 모든 베이스라인을 직접 계산한다.
       라벨→값처럼 붙어야 할 짝은 잉크 간격 20px 이상, 섹션 사이는 40px 이상.
       (라벨 baseline + 폰트 ascent(≈0.72em) 만큼 띄워야 다음 줄 윗변이 겹치지 않는다) */
    var eyebrowBase  = bandH + 80;              /* 'SDING 검산 결과' 20px */
    var nameBase     = eyebrowBase + 66;        /* 홀 이름 46px */
    var headRuleY    = nameBase + 28;
    var totalLblBase = headRuleY + 58;          /* '총 예상비용' 21px */
    var totalBase    = totalLblBase + 108;      /* 총액 100px */
    var midRuleY     = totalBase + 38;
    var colLblBase   = midRuleY + 52;           /* 2열 라벨 20px */
    var colValBase   = colLblBase + 60;         /* 2열 값 46px */
    var colNoteBase  = colValBase + 42;         /* 2열 주석 19px */
    var listLblBase  = colNoteBase + 66;        /* '항목별 내역' 19px */
    var listRuleY    = listLblBase + 20;

    /* 발행 헤더 */
    ctx.fillStyle = C.orangeInk;
    ctx.font = f(700, 20);
    tracked(ctx, 'SDING 검산 결과', PAD, eyebrowBase, 2.6);

    ctx.fillStyle = C.ink;
    ctx.font = f(700, 46);
    ctx.fillText(ellipsize(ctx, (s.hallName || '').trim() || '이름 없는 웨딩홀', innerW), PAD, nameBase);
    rule(ctx, headRuleY, C.ink, 2);

    /* 총 예상비용 */
    ctx.fillStyle = C.ink3;
    ctx.font = f(650, 21);
    tracked(ctx, '총 예상비용', PAD, totalLblBase, 1.8);

    ctx.fillStyle = C.ink;
    ctx.font = f(800, 100);
    var totalStr = Fmt.comma(r.grandTotal);
    ctx.fillText(totalStr, PAD, totalBase);
    var tw = ctx.measureText(totalStr).width;
    ctx.font = f(700, 46);
    ctx.fillText('원', PAD + tw + 12, totalBase);
    rule(ctx, midRuleY, C.rule, 1);

    /* ── 2열 지표 — 결국 얼마 내는가를 나란히 ─────────────────────────── */
    var colW = innerW / 2;
    var col2 = PAD + colW + 22;
    var rightLabel = r.hasGift ? '순수 부담액' : '청구인원';
    var rightValue = r.hasGift ? (Fmt.comma(r.netBurden) + '원') : (Fmt.comma(r.billed) + '명');
    var rightNote  = r.hasGift ? '예상 축의금 차감 후' : (r.separate ? '각보증 기준' : '통합보증 기준');

    ctx.fillStyle = C.ink3;
    ctx.font = f(650, 20);
    tracked(ctx, '1인당 실질단가', PAD, colLblBase, 1.4);
    tracked(ctx, rightLabel, col2, colLblBase, 1.4);

    ctx.fillStyle = C.orangeInk;
    ctx.font = f(780, 46);
    ctx.fillText(Fmt.comma(r.perPerson) + '원', PAD, colValBase);
    ctx.fillStyle = C.ink;
    ctx.fillText(rightValue, col2, colValBase);

    ctx.fillStyle = C.ink3;
    ctx.font = f(500, 19);
    ctx.fillText((r.perBasis === 'attended' ? '예상 참석 ' : '청구인원 ') + Fmt.comma(r.perPersonCount) + '명 기준', PAD, colNoteBase);
    ctx.fillText(rightNote, col2, colNoteBase);

    /* ── 항목별 내역 — 재발행된 견적서답게 남는 공간은 원장이 채운다 ──── */
    var footY = H - 64;
    var footRuleY = footY - 42;
    var items = [];
    for (var bi = 0; bi < r.breakdown.length; bi++) {
      var b = r.breakdown[bi];
      if (b.type === 'sub' || b.type === 'total') continue;
      items.push(b);
    }

    ctx.fillStyle = C.ink2;
    ctx.font = f(700, 19);
    tracked(ctx, '항목별 내역', PAD, listLblBase, 2.4);
    rule(ctx, listRuleY, C.ink, 2);

    if (items.length) {
      var availH = (footRuleY - 28) - listRuleY;
      var rowH = Math.min(62, Math.max(46, Math.floor(availH / items.length)));
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        /* 행 높이의 정중앙에 텍스트를 앉힌다 (baseline = 중앙 + cap/2) */
        var base = listRuleY + rowH * j + Math.round(rowH / 2) + 8;
        ctx.fillStyle = C.ink2;
        ctx.font = f(550, 22);
        ctx.fillText(ellipsize(ctx, it.label, innerW - 320), PAD, base);
        ctx.textAlign = 'right';
        ctx.fillStyle = it.amount < 0 ? C.orangeInk : C.ink;
        ctx.font = f(700, 23);
        ctx.fillText((it.amount < 0 ? '-' : '') + Fmt.comma(Math.abs(it.amount)) + '원', W - PAD, base);
        ctx.textAlign = 'left';
        if (j < items.length - 1) {
          ctx.fillStyle = C.rule;
          ctx.fillRect(PAD, listRuleY + rowH * (j + 1), innerW, 1);
        }
      }
    }

    /* ── 푸터 ────────────────────────────────────────────────────────── */
    rule(ctx, footRuleY, C.rule, 1);
    ctx.fillStyle = C.ink3;
    ctx.font = f(500, 18);
    ctx.fillText('견적 비교를 돕기 위한 참고용 계산입니다. 최종 금액은 계약서 원문으로 확인하세요.', PAD, footY);
    ctx.textAlign = 'right';
    ctx.fillStyle = C.ink2;
    ctx.font = f(700, 18);
    tracked(ctx, 'SDING', W - PAD, footY, 3);
    ctx.textAlign = 'left';

    return cv;
  }

  function canvasToBlob(cv) {
    return new Promise(function (resolve, reject) {
      if (cv.toBlob) {
        cv.toBlob(function (b) { b ? resolve(b) : reject(new Error('blob failed')); }, 'image/png');
      } else {
        try {
          var data = cv.toDataURL('image/png').split(',')[1];
          var bin = atob(data);
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: 'image/png' }));
        } catch (e) { reject(e); }
      }
    });
  }

  function fileName(s) {
    var name = (s.hallName || '웨딩홀').trim().replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24);
    return 'sding-견적검산-' + name + '.png';
  }

  function fontsReady() {
    if (document.fonts && document.fonts.ready) {
      return document.fonts.ready.catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  /* 이미지 저장(다운로드) */
  function saveImage(s, r) {
    return fontsReady()
      .then(function () { return canvasToBlob(renderCanvas(s, r)); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = fileName(s);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        return true;
      });
  }

  /* 공유 — 이미지 파일 공유 → 텍스트 공유 → 복사 순으로 자동 강등 */
  function shareResult(s, r) {
    var text = buildText(s, r);
    var title = 'Sding 견적 검산 · ' + ((s.hallName || '').trim() || '웨딩홀');

    return fontsReady()
      .then(function () { return canvasToBlob(renderCanvas(s, r)); })
      .then(function (blob) {
        var file = new File([blob], fileName(s), { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
          return navigator.share({ files: [file], title: title, text: title }).then(function () { return 'image'; });
        }
        throw new Error('no file share');
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return 'cancelled';
        if (navigator.share) {
          return navigator.share({ title: title, text: text })
            .then(function () { return 'text'; })
            .catch(function (e2) {
              if (e2 && e2.name === 'AbortError') return 'cancelled';
              return copyText(text).then(function () { return 'copied'; });
            });
        }
        return copyText(text).then(function () { return 'copied'; });
      });
  }

  return {
    buildText: buildText,
    copyText: copyText,
    buildCompareLink: buildCompareLink,
    readCompareLink: readCompareLink,
    saveImage: saveImage,
    shareResult: shareResult,
    renderCanvas: renderCanvas
  };
})();
