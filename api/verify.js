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

  const { image } = req.body; // base64 문자열 (data:image/jpeg;base64, 접두어 제외)
  if (!image) {
    return res.status(400).json({ error: '이미지 데이터가 없습니다' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '서버에 GEMINI_API_KEY가 설정되지 않았습니다' });
  }

  const promptText =
    '이 사진 속 사람이 물이나 음료를 마시고 있는 모습인지 판별해줘.\n' +
    '판정 기준(관대하게 적용):\n' +
    '- 컵, 물병, 텀블러, 캔 등이 입에 닿아 있거나 입 근처(수 cm 이내)에 있으면 YES\n' +
    '- 고개를 젖히고 마시는 자세, 용기를 기울인 자세도 YES\n' +
    '- 용기가 얼굴/입과 전혀 관련 없이 손에만 들려 있는 경우만 NO\n' +
    '- 애매하면 YES 쪽으로 판단해\n\n' +
    '반드시 아래 JSON 형식으로만 답하고 다른 텍스트, 코드블록, 설명은 절대 포함하지 마:\n' +
    '{"drinking": true 또는 false, "reason": "10자 이내 한국어 이유"}';

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: promptText },
                { inline_data: { mime_type: 'image/jpeg', data: image } },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: 'Gemini API 오류: ' + errText });
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
    return res.status(500).json({ error: '서버 오류: ' + err.message });
  }
}
