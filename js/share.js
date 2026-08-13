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
    L.push('1인당 실질단가  ' + Fmt.won(r.perPerson));
    if (r.phantom > 0) {
      L.push('허수인원       ' + Fmt.people(r.phantom) + ' (' + Fmt.won(r.phantomCost) + ')');
    }
    L.push('');
    L.push('· 청구인원 ' + Fmt.people(r.billed) + ' / 실제참석 ' + Fmt.people(r.attendedTotal));
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

    var y = bandH + 66;

    /* 대상 */
    ctx.fillStyle = C.orangeInk;
    ctx.font = f(700, 20);
    tracked(ctx, 'SDING 검산 결과', PAD, y, 2.6);
    y += 40;

    ctx.fillStyle = C.ink;
    ctx.font = f(700, 44);
    ctx.fillText(ellipsize(ctx, (s.hallName || '').trim() || '이름 없는 웨딩홀', innerW), PAD, y);
    y += 26;
    rule(ctx, y, C.ink, 2);
    y += 58;

    /* 총 예상비용 */
    ctx.fillStyle = C.ink3;
    ctx.font = f(650, 22);
    tracked(ctx, '총 예상비용', PAD, y, 1.8);
    y += 76;

    ctx.fillStyle = C.ink;
    ctx.font = f(800, 100);
    var totalStr = Fmt.comma(r.grandTotal);
    ctx.fillText(totalStr, PAD, y);
    var tw = ctx.measureText(totalStr).width;
    ctx.font = f(700, 46);
    ctx.fillText('원', PAD + tw + 10, y);
    y += 42;
    rule(ctx, y, C.rule, 1);
    y += 50;

    /* 2열 지표 */
    var colW = innerW / 2;
    var col2 = PAD + colW + 22;
    ctx.fillStyle = C.ink3;
    ctx.font = f(650, 20);
    tracked(ctx, '1인당 실질단가', PAD, y, 1.4);
    tracked(ctx, '청구 / 실제참석', col2, y, 1.4);
    y += 48;

    ctx.fillStyle = C.orangeInk;
    ctx.font = f(780, 46);
    ctx.fillText(Fmt.comma(r.perPerson) + '원', PAD, y);
    ctx.fillStyle = C.ink;
    ctx.fillText(Fmt.comma(r.billed) + ' / ' + Fmt.comma(r.attendedTotal) + '명', col2, y);
    y += 32;

    ctx.fillStyle = C.ink3;
    ctx.font = f(500, 19);
    ctx.fillText('실제 참석 ' + Fmt.comma(r.attendedTotal) + '명 기준', PAD, y);
    ctx.fillText(r.separate ? '각보증 기준' : '통합보증 기준', col2, y);
    y += 46;

    /* ── 허수 블록 (좌석 행 수에 맞춰 높이 계산) ──────────────────────── */
    var padIn = 38;
    var dot = 12, gap = 8;
    var seatAreaW = innerW - padIn * 2;
    var perRow = Math.max(1, Math.floor((seatAreaW + gap) / (dot + gap)));
    var maxRows = 6;
    var unit = 1;
    if (r.billed > perRow * maxRows) unit = Math.ceil(r.billed / (perRow * maxRows));
    var dots = Math.max(0, Math.ceil(r.billed / unit));
    var phantomDots = Math.min(dots, Math.round(r.phantom / unit));
    var attendedDots = dots - phantomDots;
    var rows = Math.max(1, Math.ceil(dots / perRow));
    var seatsH = rows * (dot + gap) - gap;

    var footY = H - 64;
    var netH = r.hasGift ? 96 : 0;

    var blockY = y;
    var blockH = r.phantom > 0 ? (padIn + 26 + 62 + 34 + seatsH + 30 + padIn) : (padIn + 26 + 62 + 24 + padIn);

    /* 남는 세로 공간은 허수 블록이 흡수한다 — 이 이미지의 주인공이므로 */
    var slack = Math.max(0, (footY - 78) - (blockY + blockH + 50 + netH));
    var grow = Math.min(slack * 0.6, 240);
    blockH += grow;
    var bo = grow / 2;                       /* 블록 내부 콘텐츠 아래로 밀기 */
    var gapAfterBlock = 50 + (slack - grow) * 0.55;

    ctx.fillStyle = C.rust;
    roundRect(ctx, PAD, blockY, innerW, blockH, 22);
    ctx.fill();

    var bx = PAD + padIn;
    var by = blockY + padIn + 20 + bo;
    ctx.fillStyle = C.rustTint;
    ctx.font = f(700, 20);
    tracked(ctx, '허수인원 — 안 왔는데 결제하는 자리', bx, by, 2.2);
    by += 62;

    if (r.phantom > 0) {
      ctx.fillStyle = '#FFFFFF';
      ctx.font = f(800, 62);
      var pStr = Fmt.comma(r.phantom) + '명';
      ctx.fillText(pStr, bx, by);
      var pw = ctx.measureText(pStr).width;
      ctx.fillStyle = C.rustTint;
      ctx.font = f(400, 46);
      ctx.fillText('·', bx + pw + 22, by);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = f(800, 62);
      ctx.fillText(Fmt.comma(r.phantomCost) + '원', bx + pw + 52, by);

      /* 좌석 — 찬 점은 실제 참석, 빈 점은 허수 */
      var seatY = by + 34;
      for (var i = 0; i < dots; i++) {
        var cx = bx + (i % perRow) * (dot + gap) + dot / 2;
        var cy = seatY + Math.floor(i / perRow) * (dot + gap) + dot / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, dot / 2, 0, Math.PI * 2);
        if (i >= attendedDots) {
          ctx.strokeStyle = 'rgba(255,255,255,.62)';
          ctx.lineWidth = 1.8;
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255,255,255,.94)';
          ctx.fill();
        }
      }

      /* 범례 — 글리프 대신 실제 점을 그린다.
         위쪽 '실제참석'은 아동 포함이라 같은 말을 쓰면 숫자가 어긋나 보인다.
         좌석도는 성인 기준이므로 '앉는 자리 / 비는 자리'로 부른다. */
      var ly = seatY + seatsH + 24;
      var legend1 = '앉는 자리 ' + Fmt.comma(r.attendedAdults);
      ctx.font = f(500, 18);
      ctx.beginPath(); ctx.arc(bx + 5, ly - 5, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.94)'; ctx.fill();
      ctx.fillStyle = C.rustTint;
      ctx.fillText(legend1, bx + 20, ly);
      var lx2 = bx + 20 + ctx.measureText(legend1).width + 34;
      ctx.beginPath(); ctx.arc(lx2 + 5, ly - 5, 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.62)'; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.fillStyle = C.rustTint;
      ctx.fillText('비는 자리 ' + Fmt.comma(r.phantom) + (unit > 1 ? '   (점 1개 = ' + unit + '명)' : ''), lx2 + 20, ly);
    } else {
      ctx.fillStyle = '#FFFFFF';
      ctx.font = f(800, 54);
      ctx.fillText('없음', bx, by);
      ctx.fillStyle = C.rustTint;
      ctx.font = f(500, 20);
      ctx.fillText('보증인원을 실제 참석인원이 채웁니다.', bx, by + 34);
    }

    y = blockY + blockH + gapAfterBlock;

    /* ── 순수 부담액 ─────────────────────────────────────────────────── */
    if (r.hasGift) {
      ctx.fillStyle = C.ink3;
      ctx.font = f(650, 20);
      tracked(ctx, '순수 부담액 · 예상 축의금 차감 후', PAD, y, 1.4);
      y += 52;
      ctx.fillStyle = r.netBurden < 0 ? C.orangeInk : C.ink;
      ctx.font = f(800, 52);
      ctx.fillText(Fmt.comma(r.netBurden) + '원', PAD, y);
    }

    /* ── 푸터 ────────────────────────────────────────────────────────── */
    rule(ctx, footY - 42, C.rule, 1);
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
    saveImage: saveImage,
    shareResult: shareResult,
    renderCanvas: renderCanvas
  };
})();
