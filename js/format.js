/* =============================================================================
   format.js — 숫자 포맷 · 파싱 유틸
   ========================================================================== */

var Fmt = (function () {

  /* 문자열/숫자를 안전한 유한 숫자로 */
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v === null || v === undefined) return 0;
    var s = String(v).replace(/[^0-9.\-]/g, '');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  /* 0 이상 정수 */
  function int(v) {
    return Math.max(0, Math.round(num(v)));
  }

  /* 1,234,567 */
  function comma(v) {
    var n = Math.round(num(v));
    var neg = n < 0;
    var s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s;
  }

  /* 1,234,567원 */
  function won(v) {
    return comma(v) + '원';
  }

  /* 큰 금액을 억/만 단위로 요약 — 3,277만원 / 1억 2,340만원 */
  function korShort(v) {
    var n = Math.round(num(v));
    var neg = n < 0;
    n = Math.abs(n);
    var out;
    if (n >= 100000000) {
      var eok = Math.floor(n / 100000000);
      var man = Math.round((n % 100000000) / 10000);
      out = man > 0 ? (comma(eok) + '억 ' + comma(man) + '만원') : (comma(eok) + '억원');
    } else if (n >= 10000) {
      out = comma(Math.round(n / 10000)) + '만원';
    } else {
      out = comma(n) + '원';
    }
    return (neg ? '-' : '') + out;
  }

  /* 명 */
  function people(v) {
    return comma(v) + '명';
  }

  /* 입력창 표시용: 숫자만 남기고 콤마 재삽입 (커서 위치 보존) ------------- */
  function applyNumericMask(input) {
    var raw = input.value;
    var selEnd = input.selectionEnd;
    /* 커서 앞의 숫자 개수 */
    var digitsBefore = (raw.slice(0, selEnd).match(/\d/g) || []).length;

    var digits = raw.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
    var masked = digits === '' ? '' : comma(digits);

    if (masked !== raw) {
      input.value = masked;
      /* 같은 개수의 숫자를 지난 지점으로 커서 복원 */
      var pos = 0, seen = 0;
      if (digitsBefore <= 0) {
        pos = 0;
      } else {
        for (pos = 0; pos < masked.length; pos++) {
          if (/\d/.test(masked[pos])) seen++;
          if (seen >= digitsBefore) { pos++; break; }
        }
      }
      try { input.setSelectionRange(pos, pos); } catch (e) { /* type=text 외 무시 */ }
    }
    return digits === '' ? '' : parseInt(digits, 10);
  }

  return {
    num: num,
    int: int,
    comma: comma,
    won: won,
    korShort: korShort,
    people: people,
    applyNumericMask: applyNumericMask
  };
})();
