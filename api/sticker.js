// api/sticker.js
// 음수 인증 성공 시 보여줄 OGQ 스티커를 가져오는 함수.
// OGQ_API_KEY는 이 파일(서버)에서만 사용되고 브라우저에는 절대 노출되지 않는다.
// 이 기능은 완전히 "보너스"다 — 실패해도 음수 인증 핵심 기능엔 전혀 영향 없다.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET 요청만 허용됩니다' });
  }

  const apiKey = process.env.OGQ_API_KEY;
  if (!apiKey) {
    // 키가 아직 설정 안 됐어도 에러로 취급하지 않는다 (스티커는 보너스 기능이므로)
    return res.status(200).json({ available: false });
  }

  try {
    // 무료 스티커 카탈로그(약 38건) 중 인기순 상위 일부를 가져와서 그중 하나를 랜덤으로 고른다.
    // 매 성공마다 매번 새로 검색하면 분당 60회 한도에 금방 걸릴 수 있으니,
    // pageSize를 넉넉히 받아서 서버 메모리에 잠깐 캐싱해둔다.
    const now = Date.now();
    const CACHE_MS = 5 * 60 * 1000; // 5분 캐시
    if (!globalThis.__ogqCache || now - globalThis.__ogqCacheAt > CACHE_MS) {
      const resp = await fetch(
        'https://4th-ai-ogq.competition.ogq.me/v1/assets?type=STICKER&pageSize=40',
        { headers: { 'X-OGQ-API-KEY': apiKey } }
      );
      if (!resp.ok) {
        console.error('OGQ API 오류:', resp.status, await resp.text());
        return res.status(200).json({ available: false });
      }
      const data = await resp.json();
      globalThis.__ogqCache = data.elements || [];
      globalThis.__ogqCacheAt = now;
    }

    const list = globalThis.__ogqCache;
    if (!list || list.length === 0) {
      return res.status(200).json({ available: false });
    }

    const pick = list[Math.floor(Math.random() * list.length)];
    return res.status(200).json({
      available: true,
      title: pick.title || 'OGQ 스티커',
      imageUrl: pick.thumbnailUrl,
      creator: pick.creator?.nickname || 'OGQ',
    });
  } catch (err) {
    console.error('OGQ 스티커 요청 실패:', err);
    // 실패해도 조용히 "없음"으로 응답 — 음수 인증 자체엔 영향 없게 함
    return res.status(200).json({ available: false });
  }
}
