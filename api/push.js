// api/push.js — 화면이 꺼져 있어도 울리는 푸시 알림 (서버 전용)
//
// POST {action:'schedule', token, fireAt, lang}  → 이 기기의 다음 알람 시각을 예약
// POST {action:'cancel',   token}                → 예약 취소
// GET  ?key=CRON_SECRET                          → 외부 스케줄러(1분마다)가 호출. 시간이 된 예약에 푸시를 보냄
//
// 환경변수: FIREBASE_SERVICE_ACCOUNT (서비스 계정 JSON 전체), CRON_SECRET (임의의 긴 문자열)
// 저장 데이터: pushJobs/{토큰 해시} = {token, fireAt, lang, count}. 이름·이메일·사진은 저장하지 않으며,
// 알람이 끝나면(취소·최대 횟수 도달) 문서를 삭제한다.

import crypto from 'node:crypto';

const COLLECTION = 'pushJobs';
const MAX_SENDS = 5;            // 알람 1회당 최대 푸시 횟수 (인증 전까지 1분마다 재알림)
const RESEND_MS = 60 * 1000;
const STALE_MS = 10 * 60 * 1000; // 스케줄러가 멈춰 10분 넘게 지난 예약은 보내지 않고 정리
const MAX_AHEAD_MS = 12 * 60 * 60 * 1000;

const MESSAGES = {
  ko: ['💧 물 마실 시간!', '지금 물을 마시고 인증해 주세요.'],
  en: ['💧 Time to drink water!', 'Drink some water and verify it now.'],
  ja: ['💧 水を飲む時間です！', '今すぐ水を飲んで認証してください。'],
  zh: ['💧 该喝水了！', '请现在喝水并完成验证。'],
  vi: ['💧 Đến giờ uống nước!', 'Hãy uống nước và xác minh ngay.'],
  th: ['💧 ถึงเวลาดื่มน้ำแล้ว!', 'ดื่มน้ำแล้วยืนยันตอนนี้เลย'],
  id: ['💧 Waktunya minum air!', 'Minumlah air dan verifikasi sekarang.'],
  tl: ['💧 Oras na para uminom ng tubig!', 'Uminom ng tubig at i-verify ngayon.'],
};

function jobId(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 40);
}

let cached;
async function getDeps() {
  if (globalThis.__PUSH_TEST_DEPS__) return globalThis.__PUSH_TEST_DEPS__;
  if (cached) return cached;
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getMessaging } = await import('firebase-admin/messaging');
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT 환경변수가 없습니다');
  const sa = JSON.parse(raw);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  const app = getApps()[0] || initializeApp({ credential: cert(sa) });
  cached = { db: getFirestore(app), messaging: getMessaging(app) };
  return cached;
}

// 시간이 된 예약을 처리한다. 테스트하기 쉽게 db·messaging·now를 인자로 받는다.
export async function processDue(db, messaging, now) {
  const snap = await db.collection(COLLECTION).where('fireAt', '<=', now).limit(200).get();
  let sent = 0, dropped = 0;
  for (const doc of snap.docs) {
    const job = doc.data();
    if (now - job.fireAt > STALE_MS) { await doc.ref.delete(); dropped++; continue; }
    const [title, body] = MESSAGES[job.lang] || MESSAGES.ko;
    try {
      await messaging.send({
        token: job.token,
        data: { title, body, url: '/' },
        webpush: { headers: { Urgency: 'high', TTL: '120' } },
      });
      sent++;
      const count = (job.count || 0) + 1;
      if (count >= MAX_SENDS) await doc.ref.delete();
      else await doc.ref.set({ ...job, count, fireAt: now + RESEND_MS });
    } catch (e) {
      // 만료·삭제된 토큰이면 예약도 지운다. 그 외 오류는 다음 분에 다시 시도한다.
      const code = (e && e.code) || '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
        await doc.ref.delete(); dropped++;
      }
    }
  }
  return { due: snap.size, sent, dropped };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.query.key !== secret) return res.status(401).json({ error: 'unauthorized' });
      const { db, messaging } = await getDeps();
      return res.status(200).json(await processDue(db, messaging, Date.now()));
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'GET 또는 POST만 허용됩니다' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { action, token } = body;
    if (typeof token !== 'string' || token.length < 50 || token.length > 4096) {
      return res.status(400).json({ error: 'invalid token' });
    }
    const { db } = await getDeps();
    const ref = db.collection(COLLECTION).doc(jobId(token));

    if (action === 'cancel') {
      await ref.delete();
      return res.status(200).json({ ok: true });
    }
    if (action === 'schedule') {
      const fireAt = Number(body.fireAt);
      const now = Date.now();
      if (!Number.isFinite(fireAt) || fireAt < now - 5000 || fireAt > now + MAX_AHEAD_MS) {
        return res.status(400).json({ error: 'invalid fireAt' });
      }
      const lang = MESSAGES[body.lang] ? body.lang : 'ko';
      await ref.set({ token, fireAt, lang, count: 0 });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}
