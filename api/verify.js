// api/verify.js
// 이 파일은 서버(Vercel)에서만 실행됩니다. 브라우저는 절대 이 코드를 직접 볼 수 없고,
// API 키도 여기 환경변수로만 존재하므로 안전합니다.

export default async function handler(req, res) {
  // CORS 허용 (필요 시)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다' });
  }

  const { image, lang } = req.body; // base64 문자열 (data:image/jpeg;base64, 접두어 제외), lang: 'ko'|'en'|'ja'
  if (!image) {
    return res.status(400).json({ error: '이미지 데이터가 없습니다' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '서버에 GEMINI_API_KEY가 설정되지 않았습니다' });
  }

  const reasonLangInstruction = {
    ko: '이유(reason)는 반드시 한국어로 10자 이내로 작성해',
    en: 'Write the reason in English, under 6 words',
    ja: '理由(reason)は必ず日本語で10文字以内で書いて',
  }[lang] || '이유(reason)는 반드시 한국어로 10자 이내로 작성해';

  const promptText =
    '이 사진 속 사람이 물이나 음료를 마시고 있는 모습인지 판별해줘.\n' +
    '판정 기준(관대하게 적용):\n' +
    '- 컵, 물병, 텀블러, 캔 등이 입에 닿아 있거나 입 근처(수 cm 이내)에 있으면 YES\n' +
    '- 고개를 젖히고 마시는 자세, 용기를 기울인 자세도 YES\n' +
    '- 용기가 얼굴/입과 전혀 관련 없이 손에만 들려 있는 경우만 NO\n' +
    '- 애매하면 YES 쪽으로 판단해\n\n' +
    '반드시 아래 JSON 형식으로만 답하고 다른 텍스트, 코드블록, 설명은 절대 포함하지 마:\n' +
    '{"drinking": true 또는 false, "reason": "짧은 이유"}\n' +
    reasonLangInstruction;

  const PRIMARY_MODEL = 'gemini-3.5-flash';       // 우선 시도할 모델 (더 정교함)
  const FALLBACK_MODEL = 'gemini-3.5-flash-lite'; // 실패 시 1회만 대체 시도할 모델 (같은 구글 서비스라 추가 비용 없음)
  const urlFor = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const baseBody = {
    contents: [
      {
        parts: [
          { text: promptText },
          { inline_data: { mime_type: 'image/jpeg', data: image } },
        ],
      },
    ],
  };
  // 사진 한 장 판별은 깊은 추론이 필요 없다. 추론(thinking) 시간을 줄여 응답을 빠르게 한다.
  // (모델이 이 옵션을 지원하지 않아 400이 나오면 아래 시도 목록의 마지막 줄이 옵션 없이 다시 시도한다.)
  const fastBody = JSON.stringify({
    ...baseBody,
    generationConfig: { thinkingConfig: { thinkingLevel: 'low' } },
  });
  const plainBody = JSON.stringify(baseBody);

  // 이전에는 첫 모델이 오래 걸리면 함수 제한시간(vercel.json의 maxDuration)이 먼저 끝나서
  // 대체 모델은 시도조차 못 하고 504(시간초과)가 났다. 호출 1건마다 따로 제한시간을 두고,
  // 늦으면 바로 끊고 다음 시도로 넘어가도록 바꿨다.
  const TOTAL_BUDGET_MS = 50000;   // 전체 상한 (maxDuration 60초보다 여유 있게)
  const PER_CALL_MS = 18000;       // 호출 1건 상한
  const startedAt = Date.now();

  async function callGemini(model, body) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining < 3000) throw new Error('BUDGET_EXHAUSTED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(PER_CALL_MS, remaining));
    try {
      return await fetch(urlFor(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  const attempts = [
    { model: PRIMARY_MODEL, body: fastBody },
    { model: FALLBACK_MODEL, body: fastBody },
    { model: FALLBACK_MODEL, body: plainBody },
  ];

  try {
    let response = null;
    let lastErrText = '';
    let timedOut = false;

    for (const a of attempts) {
      try {
        const r = await callGemini(a.model, a.body);
        if (r.ok) { response = r; break; }
        lastErrText = await r.text();
        console.warn(`Gemini(${a.model}) 실패`, r.status, lastErrText.slice(0, 200));
        response = r; // 마지막 실패 응답을 기억해 둔다
      } catch (e) {
        timedOut = true;
        console.warn(`Gemini(${a.model}) 시간초과 또는 연결 오류`, e && e.name);
        response = null;
        if (e && e.message === 'BUDGET_EXHAUSTED') break;
      }
    }

    if (!response || !response.ok) {
      if (!response && timedOut) {
        return res.status(504).json({ error: 'AI_TIMEOUT' });
      }
      console.error('Gemini API 오류 상세:', response && response.status, lastErrText);
      return res.status((response && response.status) || 502).json({ error: 'AI_API_ERROR' });
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    let raw = parts.map((p) => p.text || '').join('');
    raw = raw.replace(/```json|```/g, '').trim();

    let result = { drinking: false, reason: '판별 실패' };
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      result = { drinking: !!parsed.drinking, reason: parsed.reason || '' };
    } catch (e) {
      const upper = raw.toUpperCase();
      result = { drinking: upper.includes('YES') || upper.includes('TRUE'), reason: '' };
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('서버 오류 상세:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
}
