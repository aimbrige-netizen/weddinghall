/* =============================================================================
   calc.js — 견적 계산 엔진 (순수 함수)

   ── 핵심 산식 ────────────────────────────────────────────────────────────
   청구인원
     · 통합보증 : MAX(총 보증인원, 총 예상참석)
     · 각  보증 : MAX(신랑 보증, 신랑 참석) + MAX(신부 보증, 신부 참석)
   1인당 실질단가 = 총 예상비용 ÷ (청구인원 | 예상 참석인원)
                    ※ 사용자가 perPersonBasis 로 고릅니다. 기본값은 청구인원.
                      예상 참석 기준을 골랐는데 참석 입력이 비어 있으면 청구인원으로 자동 대체합니다.
   허수인원       = 청구인원 − 예상 참석인원(성인)
                    ※ 엔진 내부 값. 2026-08-13 사용자 결정으로 UI·공유물에는 노출하지 않는다.
   ------------------------------------------------------------------------
   ※ 아동은 청구인원(보증인원 기준)과 별개로 추가 합산합니다.
   ※ 주류·음료는 참석인원이 아니라 청구인원 전체에 곱합니다.
   ========================================================================== */

var Calc = (function () {

  var N = Fmt.num;
  var I = Fmt.int;

  function optionsBaseOf(s) {
    if (s.optionMode === 'detail') {
      var sum = 0;
      for (var i = 0; i < CONFIG.optionDetailFields.length; i++) {
        sum += N(s[CONFIG.optionDetailFields[i].key]);
      }
      return sum;
    }
    return N(s.optionTotal);
  }

  function run(s) {
    s = s || {};

    /* ── 인원 ──────────────────────────────────────────────────────────── */
    var groomGuar = I(s.groomGuarantee);
    var brideGuar = I(s.brideGuarantee);
    var groomExp  = I(s.groomExpected);
    var brideExp  = I(s.brideExpected);
    var uniGuar   = I(s.unifiedGuarantee);
    var childCount = I(s.childCount);

    var attendedAdults = groomExp + brideExp;
    var attendedTotal  = attendedAdults + childCount;

    var separate = s.guaranteeMode === 'separate';
    var billed = separate
      ? Math.max(groomGuar, groomExp) + Math.max(brideGuar, brideExp)
      : Math.max(uniGuar, attendedAdults);

    var guaranteeTotal = separate ? (groomGuar + brideGuar) : uniGuar;
    var phantom = Math.max(0, billed - attendedAdults);

    /* ── 부가세 배수 ───────────────────────────────────────────────────── */
    var mealMul  = s.mealVatMode  === 'excluded' ? (1 + CONFIG.VAT_RATE) : 1;
    var otherMul = s.otherVatMode === 'excluded' ? (1 + CONFIG.VAT_RATE) : 1;

    /* ── 식대 ──────────────────────────────────────────────────────────── */
    var adultUnitBase = N(s.adultMealPrice);
    var childUnitBase = N(s.childMealPrice);
    var adultUnit = adultUnitBase * mealMul;
    var childUnit = childUnitBase * mealMul;

    var mealAdult = adultUnit * billed;
    var mealChild = childUnit * childCount;
    var mealTotal = mealAdult + mealChild;
    var mealBase  = adultUnitBase * billed + childUnitBase * childCount;
    var mealVatAdded = mealTotal - mealBase;

    /* ── 대관 · 꽃 · 주류 · 기타 · 옵션 ─────────────────────────────────── */
    var venueBase  = N(s.venueFee);
    var flowerBase = N(s.flowerFee);
    var etcBase    = N(s.etcFee);
    var drinkUnitBase = N(s.drinkPerPerson);
    var drinkBase  = drinkUnitBase * billed;
    var optBase    = optionsBaseOf(s);

    var venue  = venueBase  * otherMul;
    var flower = flowerBase * otherMul;
    var etc    = etcBase    * otherMul;
    var drinkUnit  = drinkUnitBase * otherMul;
    var drinkTotal = drinkBase * otherMul;
    var options    = optBase * otherMul;

    var otherBase  = venueBase + flowerBase + etcBase + drinkBase + optBase;
    var otherTotal = venue + flower + etc + drinkTotal + options;
    var otherVatAdded = otherTotal - otherBase;

    var vatAdded = mealVatAdded + otherVatAdded;

    /* ── 합계 ──────────────────────────────────────────────────────────── */
    var discount   = N(s.discount);
    var subtotal   = mealTotal + otherTotal;
    var grandTotal = Math.max(0, subtotal - discount);

    /* 1인당 실질단가 — 두 기준을 다 구해두고 선택값에 따라 대표값을 정한다.
       (두 값을 나란히 보여줘야 사용자가 차이를 확인할 수 있다) */
    var perPersonBilled   = billed > 0 ? grandTotal / billed : 0;
    var perPersonAttended = attendedTotal > 0 ? grandTotal / attendedTotal : 0;

    var wantAttended = s.perPersonBasis === 'attended';
    var perBasis = (wantAttended && attendedTotal > 0) ? 'attended' : 'billed';
    var perBasisFellBack = wantAttended && attendedTotal <= 0;

    var perPerson = perBasis === 'attended' ? perPersonAttended : perPersonBilled;
    var perPersonCount = perBasis === 'attended' ? attendedTotal : billed;

    /* 허수 비용 = 안 왔는데 결제되는 자리의 식대 + 주류 (둘 다 청구인원 기준) */
    var phantomCost = phantom * (adultUnit + drinkUnit);

    /* ── 축의금 · 순수 부담액 ──────────────────────────────────────────── */
    var giftPerPerson = N(s.giftPerPerson);
    var hasGift = giftPerPerson > 0 && attendedAdults > 0;
    var giftTotal = giftPerPerson * attendedAdults;   /* 예상 참석 성인 기준 */
    var netBurden = grandTotal - giftTotal;

    /* ── 내역 ──────────────────────────────────────────────────────────── */
    var bd = [];
    function push(label, amount, memo, type) {
      if (!amount && type !== 'total') return;
      bd.push({ label: label, amount: amount, memo: memo || '', type: type || 'item' });
    }

    push('식대 (성인)', mealAdult,
      Fmt.comma(billed) + '명 × ' + Fmt.won(adultUnit) + (mealMul > 1 ? ' (VAT 포함가)' : ''));

    if (childCount > 0 && childUnit > 0) {
      push('식대 (아동)', mealChild,
        Fmt.comma(childCount) + '명 × ' + Fmt.won(childUnit) + (mealMul > 1 ? ' (VAT 포함가)' : ''));
    }

    push('대관료 · 홀 사용료', venue);
    push('꽃장식', flower);
    push('주류 · 음료', drinkTotal,
      Fmt.comma(billed) + '명 × ' + Fmt.won(drinkUnit) + ' · 청구인원 전체 적용');
    push('폐백실 · 진행비 · 주차', etc);
    push('필수옵션', options, s.optionMode === 'detail' ? '항목별 입력 합계' : '');

    if (s.optionMode === 'detail') {
      for (var i = 0; i < CONFIG.optionDetailFields.length; i++) {
        var f = CONFIG.optionDetailFields[i];
        var v = N(s[f.key]) * otherMul;
        if (v > 0) bd.push({ label: f.label, amount: v, memo: '', type: 'sub' });
      }
    }

    if (discount > 0) {
      bd.push({ label: '할인 · 지원', amount: -discount, memo: '', type: 'minus' });
    }

    bd.push({ label: '총 예상비용', amount: grandTotal, memo: '', type: 'total' });

    /* ── 결과 ──────────────────────────────────────────────────────────── */
    return {
      /* 인원 */
      billed: billed,
      guaranteeTotal: guaranteeTotal,
      attendedAdults: attendedAdults,
      childCount: childCount,
      attendedTotal: attendedTotal,
      phantom: phantom,
      separate: separate,

      /* 단가 */
      adultUnit: adultUnit,
      childUnit: childUnit,
      drinkUnit: drinkUnit,

      /* 항목 */
      mealAdult: mealAdult,
      mealChild: mealChild,
      mealTotal: mealTotal,
      venue: venue,
      flower: flower,
      drinkTotal: drinkTotal,
      etc: etc,
      options: options,
      otherTotal: otherTotal,

      /* 부가세 */
      vatAdded: vatAdded,
      mealVatAdded: mealVatAdded,
      otherVatAdded: otherVatAdded,

      /* 합계 */
      discount: discount,
      subtotal: subtotal,
      grandTotal: grandTotal,
      perPerson: perPerson,
      perPersonBilled: perPersonBilled,
      perPersonAttended: perPersonAttended,
      perPersonCount: perPersonCount,
      perBasis: perBasis,
      perBasisFellBack: perBasisFellBack,
      phantomCost: phantomCost,

      /* 축의금 */
      hasGift: hasGift,
      giftPerPerson: giftPerPerson,
      giftTotal: giftTotal,
      netBurden: netBurden,

      breakdown: bd,

      /* 입력이 사실상 비어 있는지 */
      isEmpty: grandTotal <= 0 && attendedTotal <= 0
    };
  }

  return { run: run, optionsBaseOf: optionsBaseOf };
})();
